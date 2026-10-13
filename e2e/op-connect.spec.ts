import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { psql } from "./db";
import {
  OP_ITEM_NAME,
  OP_ITEM_PASSWORD,
  OP_OTHER_VAULT,
  OP_TOKEN,
  OP_VAULT,
  startFakeConnect,
  stopFakeConnect,
} from "./fake-op-connect";
import { createCompany, createDocType, createDocument, signInAsAdmin, STACK_ENV, unique } from "./support";

/**
 * 1Password through a self-hosted Connect server. The same rules the Bitwarden
 * path is held to: a picker cannot cross a client boundary, a secret is
 * fetched live and never stored, and a vault that stops answering degrades to
 * a deep link rather than an error.
 */

const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? "trove-kb-test";
const NETWORK = process.env.E2E_DOCKER_NETWORK_INTERNAL ?? `${PROJECT}_internal`;
const REPO = process.env.E2E_REPO ?? process.cwd();

const DOC_TYPE = unique("OP Firewall");
const COMPANY = unique("OP Co");
const OTHER_COMPANY = unique("OP Other");

let companyId = "";
let otherCompanyId = "";
let documentId = "";

test.describe.configure({ mode: "serial" });


function setVaultMode(mode: string, extra: Record<string, string> = {}): void {
  // The overlay is what carries VAULT_MODE and the credentials in from the
  // shell; the base file deliberately leaves them to the env file.
  const files = ["-f", "docker-compose.yml", "-f", "e2e/vault-override.yml"];
  execFileSync("docker", ["compose", "-p", PROJECT, ...files, "up", "-d", "--force-recreate", "app"], {
    cwd: REPO,
    env: { ...process.env, VAULT_MODE: mode, ...STACK_ENV, ...extra },
    stdio: "ignore",
  });

  const deadline = Date.now() + 120_000;
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

const CONNECT_ENV = {
  OP_CONNECT_URL: "http://op-connect:8080",
  OP_CONNECT_TOKEN: OP_TOKEN,
};

async function configureProvider(page: Page) {
  await page.goto("/admin/vault");

  const add = page.getByRole("button", { name: "Add provider" });
  const save = page.getByRole("button", { name: "Save provider" });
  const existing = (await save.count()) > 0;

  await page.getByLabel("Name").first().fill("Test 1Password");
  await page.getByLabel("Mode").first().selectOption("op_connect");
  await (existing ? save : add).first().click();
  await expect(page.getByText("is brokering through the sidecar.")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  startFakeConnect(NETWORK);
  setVaultMode("op_connect", CONNECT_ENV);

  const page = await browser.newPage();
  await signInAsAdmin(page);

  await createDocType(page, DOC_TYPE, [{ label: "Model", type: "text" }]);
  const docTypeId = psql(`select id from doc_types where name = '${DOC_TYPE}';`);
  await page.goto(`/admin/doc-types/${docTypeId}`);
  await page.getByLabel("Label", { exact: true }).fill("Credentials");
  await page.getByLabel("Type").selectOption("secret_ref");
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Credentials" })).toBeVisible();

  companyId = await createCompany(page, COMPANY);
  otherCompanyId = await createCompany(page, OTHER_COMPANY);
  await configureProvider(page);

  // Each client is mapped to its own 1Password vault.
  await page.goto("/admin/vault");
  for (const [company, vault] of [
    [companyId, OP_VAULT],
    [otherCompanyId, OP_OTHER_VAULT],
  ] as const) {
    await page.getByLabel("Company", { exact: true }).selectOption(company);
    await page.getByLabel("Bitwarden collection id").fill(vault);
    await page.getByRole("button", { name: "Map collection" }).click();
    await expect(page.getByText(vault).first()).toBeVisible();
  }

  documentId = await createDocument(page, companyId, DOC_TYPE, "OP edge firewall");
  await page.close();
});

test.afterAll(() => {
  test.setTimeout(180_000);
  stopFakeConnect();
  setVaultMode("link");
});

test("the picker offers the company's own 1Password vault, and no other", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}/edit`);

  await expect(page.getByRole("option", { name: new RegExp(OP_ITEM_NAME) })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /Someone elses switch/ })).toHaveCount(0);
});

test("choosing an item stores a reference, never the password", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}/edit`);

  // Exact: the drag handle beside it is labelled "Reorder Credentials".
  await page.getByLabel("Credentials", { exact: true }).selectOption({ label: OP_ITEM_NAME });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page).toHaveURL(`/documents/${documentId}`);

  const stored = psql(`select field_values::text from documents where id = '${documentId}';`);
  // The reference carries the vault and item, and the metadata worth showing.
  expect(stored).toContain(OP_VAULT);
  expect(stored).toContain("opadmin");
  expect(stored).not.toContain(OP_ITEM_PASSWORD);
});

test("the password and the one-time code are fetched live", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}`);

  await expect(page.getByText("opadmin")).toBeVisible();
  await page.getByRole("button", { name: "Reveal password" }).click();
  await expect(page.getByText(OP_ITEM_PASSWORD)).toBeVisible();

  // Connect hands back a seed rather than a code, so the code is computed
  // here and shown with the seconds left on it.
  await page.getByRole("button", { name: /TOTP|one-time/i }).first().click();
  await expect(page.getByText(/\d{6} · \d+s/)).toBeVisible();

  expect(
    psql(`select count(*) from audit_log where action = 'secret.reveal';`),
  ).not.toBe("0");
});

test("a Connect server that stops answering degrades to a link", async ({ page }) => {
  stopFakeConnect();

  await signInAsAdmin(page);
  await page.goto(`/documents/${documentId}`);

  // The reference still shows what it knows; the reveal is simply not offered.
  await expect(page.getByText("opadmin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal password" })).toHaveCount(0);

  startFakeConnect(NETWORK);
});
