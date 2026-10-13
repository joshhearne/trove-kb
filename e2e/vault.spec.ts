import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { createUser, psql } from "./db";
import {
  OTHER_COLLECTION,
  OTHER_ITEM_ID,
  startFakeVault,
  stopFakeVault,
  VAULT_COLLECTION,
  VAULT_ITEM_NAME,
  VAULT_ITEM_PASSWORD,
} from "./fake-vault";
import { createCompany, createDocType, createDocument, signInAsAdmin, STACK_ENV, unique } from "./support";

/**
 * Phase 6. The rules under test come from CLAUDE.md and
 * docs/VAULT_INTEGRATION.md: secrets are fetched live and never stored, the
 * picker cannot cross client boundaries, reveals need permission and are
 * audited, and a down sidecar degrades to link mode.
 */

const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? "trove-kb-test";
const NETWORK = process.env.E2E_DOCKER_NETWORK_INTERNAL ?? `${PROJECT}_internal`;
const REPO = process.env.E2E_REPO ?? process.cwd();

const DOC_TYPE = unique("Vault Firewall");
const COMPANY = unique("Vault Co");
const OTHER_COMPANY = unique("Vault Other");
const TECH = { email: "e2e-vault-tech@example.com", password: "a-vault-tech-password" };

let companyId = "";
let otherCompanyId = "";
let documentId = "";
let secretFieldId = "";

test.describe.configure({ mode: "serial" });

function compose(args: string[], env: Record<string, string> = {}): void {
  // The overlay is what carries VAULT_MODE in from the shell; the base file
  // deliberately leaves it to the env file.
  const files = ["-f", "docker-compose.yml", "-f", "e2e/vault-override.yml"];
  execFileSync("docker", ["compose", "-p", PROJECT, ...files, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdio: "ignore",
  });
}

/** Restarts the app with a different VAULT_MODE and waits for health. */
function setVaultMode(mode: "link" | "bw_serve"): void {
  compose(["up", "-d", "--force-recreate", "app"], { VAULT_MODE: mode, ...STACK_ENV });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = execFileSync(
      "docker",
      ["inspect", "--format", "{{.State.Health.Status}}", `${PROJECT}-app-1`],
      { encoding: "utf8" },
    ).trim();
    if (status === "healthy") return;
    execFileSync("sleep", ["2"]);
  }
  throw new Error("app did not become healthy");
}

/** Idempotent: the database persists between runs, so a provider may exist. */
async function configureProvider(page: Page) {
  await page.goto("/admin/vault");

  const add = page.getByRole("button", { name: "Add provider" });
  const save = page.getByRole("button", { name: "Save provider" });
  const existing = (await save.count()) > 0;

  await page.getByLabel("Name").first().fill("Test Vaultwarden");
  await page.getByLabel("Mode").first().selectOption("bw_serve");
  await page.getByLabel("Web vault URL").first().fill("https://vault.example.com");
  await (existing ? save : add).first().click();

  await expect(page.getByText("is brokering through the sidecar.")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  // Restarting the app and building the fixtures takes longer than a test.
  test.setTimeout(240_000);
  startFakeVault(NETWORK);
  setVaultMode("bw_serve");

  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, DOC_TYPE, [{ label: "Model", type: "text" }]);
  const docTypeUrl = `/admin/doc-types/${psql(`select id from doc_types where name = '${DOC_TYPE}';`)}`;
  await page.goto(docTypeUrl);
  await page.getByLabel("Label", { exact: true }).fill("Credentials");
  await page.getByLabel("Type").selectOption("secret_ref");
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Credentials" })).toBeVisible();

  secretFieldId = psql(
    `select id from fields where label = 'Credentials' and doc_type_id = ` +
      `(select id from doc_types where name = '${DOC_TYPE}');`,
  );

  companyId = await createCompany(page, COMPANY);
  otherCompanyId = await createCompany(page, OTHER_COMPANY);

  await configureProvider(page);

  // Each company sees only its own collection.
  await page.goto("/admin/vault");
  await page.getByLabel("Company", { exact: true }).selectOption(companyId);
  await page.getByLabel("Bitwarden collection id").fill(VAULT_COLLECTION);
  await page.getByRole("button", { name: "Map collection" }).click();
  await expect(page.getByText(VAULT_COLLECTION).first()).toBeVisible();

  await page.getByLabel("Company", { exact: true }).selectOption(otherCompanyId);
  await page.getByLabel("Bitwarden collection id").fill(OTHER_COLLECTION);
  await page.getByRole("button", { name: "Map collection" }).click();
  await expect(page.getByText(OTHER_COLLECTION).first()).toBeVisible();

  documentId = await createDocument(page, companyId, DOC_TYPE, "Edge firewall");
  createUser(TECH.email, "tech", TECH.password);
  // An earlier run may have granted the permission; this suite starts without it.
  psql(`update users set can_reveal_secrets = false where email = '${TECH.email}';`);
  await page.close();
});

test.afterAll(() => {
  test.setTimeout(180_000);
  stopFakeVault();
  setVaultMode("link");
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/companies/);
}

test("the picker offers only the company's own collection", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}/edit`);

  const picker = page.getByRole("combobox", { name: "Credentials", exact: true });
  const labels = await picker.locator("option").allTextContents();

  expect(labels).toContain(VAULT_ITEM_NAME);
  expect(labels).not.toContain("Someone elses router");
});

test("choosing an item stores a reference, never a secret", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}/edit`);
  await page
    .getByRole("combobox", { name: "Credentials", exact: true })
    .selectOption({ label: VAULT_ITEM_NAME });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${documentId}`);

  const stored = psql(
    `select field_values->>'${secretFieldId}' from documents where id = '${documentId}';`,
  );
  expect(stored).toContain("item-firewall");
  expect(stored).toContain("Firewall admin");
  // The whole point: no password, no seed, anywhere in the row.
  expect(stored).not.toContain(VAULT_ITEM_PASSWORD);
  expect(stored).not.toContain("JBSWY3DPEHPK3PXP");

  const everything = psql(
    `select coalesce(string_agg(field_values::text, ' '), '') || ' ' || ` +
      `coalesce((select string_agg(field_values::text, ' ') from document_revisions), '') || ' ' || ` +
      `coalesce((select string_agg(search_text, ' ') from documents), '') || ' ' || ` +
      `coalesce((select string_agg(detail::text, ' ') from audit_log), '') from documents;`,
  );
  expect(everything).not.toContain(VAULT_ITEM_PASSWORD);
  expect(everything).not.toContain("JBSWY3DPEHPK3PXP");
});

test("the document shows metadata and reveals on request", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}`);

  await expect(page.getByText(VAULT_ITEM_NAME)).toBeVisible();
  // "admin" is also the role chip in the header, so scope to the document.
  await expect(page.locator("main").getByText("admin", { exact: true })).toBeVisible();
  // Nothing secret is on the page until asked for.
  expect(await page.content()).not.toContain(VAULT_ITEM_PASSWORD);

  await page.getByRole("button", { name: "Reveal password" }).click();
  await expect(page.getByText(VAULT_ITEM_PASSWORD)).toBeVisible();

  await page.getByRole("button", { name: "TOTP" }).click();
  await expect(page.getByRole("button", { name: /123456/ })).toBeVisible();

  const actions = psql(`select string_agg(distinct action, ',' order by action) from audit_log;`);
  expect(actions).toContain("secret.reveal");
  expect(actions).toContain("secret.copy_totp");

  const details = psql(
    `select string_agg(detail::text, ' ') from audit_log where action = 'secret.reveal';`,
  );
  expect(details).toContain("item-firewall");
  expect(details).not.toContain(VAULT_ITEM_PASSWORD);
});

test("a user without the permission cannot reveal", async ({ page }) => {
  await signIn(page, TECH.email, TECH.password);
  await page.goto(`/documents/${documentId}`);

  await expect(page.getByText("You do not have permission to reveal secrets.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal password" })).toHaveCount(0);

  const before = psql(`select count(*) from audit_log where action = 'secret.reveal';`);

  // Granting the permission is what changes it.
  const admin = await page.context().browser()?.newPage();
  if (!admin) throw new Error("no browser");
  await signInAsAdmin(admin);
  await admin.goto("/admin/users");
  const row = admin.getByRole("listitem").filter({ hasText: TECH.email });
  await row.getByRole("button", { name: "Grant" }).click();

  // Wait for the grant to be applied, not merely requested.
  await expect(row.getByText("May reveal secrets")).toBeVisible();
  await admin.close();

  await page.reload();
  await page.getByRole("button", { name: "Reveal password" }).click();
  await expect(page.getByText(VAULT_ITEM_PASSWORD)).toBeVisible();

  expect(Number(psql(`select count(*) from audit_log where action = 'secret.reveal';`))).toBe(
    Number(before) + 1,
  );
});

test("the API needs an explicit secrets:reveal scope", async ({ page, request }) => {
  await signInAsAdmin(page);

  async function makeKey(name: string, scopes: string[]): Promise<string> {
    await page.goto("/admin/api-keys");
    await page.getByLabel("Name").fill(name);
    for (const scope of ["read", "write", "admin", "secrets:reveal"]) {
      const box = page.getByRole("checkbox", { name: scope, exact: true });
      if (scopes.includes(scope)) await box.check();
      else await box.uncheck();
    }
    await page.getByRole("radio", { name: "Every company" }).check();
    await page.getByRole("button", { name: "Create key" }).click();
    return (await page.getByRole("status", { name: "New API key" }).textContent()) as string;
  }

  const adminKey = await makeKey(unique("admin key"), ["admin"]);
  const revealKey = await makeKey(unique("reveal key"), ["read", "secrets:reveal"]);

  const body = { document_id: documentId, field_id: secretFieldId };

  // admin does not imply secrets:reveal.
  const refused = await request.post("/api/v1/vault/items/item-firewall/reveal", {
    headers: { Authorization: `Bearer ${adminKey}` },
    data: body,
  });
  expect(refused.status()).toBe(403);

  const allowed = await request.post("/api/v1/vault/items/item-firewall/reveal", {
    headers: { Authorization: `Bearer ${revealKey}` },
    data: body,
  });
  expect(allowed.status()).toBe(200);
  expect((await allowed.json()).password).toBe(VAULT_ITEM_PASSWORD);
  expect(allowed.headers()["cache-control"]).toContain("no-store");

  // An item from another client's collection is refused even with the scope.
  const crossClient = await request.post(`/api/v1/vault/items/${OTHER_ITEM_ID}/reveal`, {
    headers: { Authorization: `Bearer ${revealKey}` },
    data: body,
  });
  expect(crossClient.status()).toBe(403);

  const items = await request.get(`/api/v1/vault/items?company_id=${companyId}`, {
    headers: { Authorization: `Bearer ${revealKey}` },
  });
  const listed = await items.json();
  expect(listed.data.map((item: { name: string }) => item.name)).toEqual([VAULT_ITEM_NAME]);
  expect(JSON.stringify(listed)).not.toContain(VAULT_ITEM_PASSWORD);
});

test("secret references never reach a webhook payload", async () => {
  const payloads = psql(
    `select coalesce(string_agg(payload::text, ' '), '') from webhook_deliveries;`,
  );
  expect(payloads).not.toContain(VAULT_ITEM_PASSWORD);
  expect(payloads).not.toContain("item-firewall");
});

test("a sidecar that goes away degrades to link mode", async ({ page }) => {
  stopFakeVault();

  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}`);

  await expect(page.getByText(/unreachable, so this field is showing a link only/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in the web vault" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal password" })).toHaveCount(0);

  // The stored reference is untouched by the outage.
  expect(
    psql(`select field_values->>'${secretFieldId}' from documents where id = '${documentId}';`),
  ).toContain("item-firewall");
});
