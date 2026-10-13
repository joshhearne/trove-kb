import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { psql } from "./db";
import { ADMIN, openAccountMenu, signInAsAdmin, STACK_ENV } from "./support";
import { CLIENT_ID, ISSUER, MOCK_OIDC_ORIGIN, startMockOidc, stopMockOidc } from "./mock-oidc";

/**
 * Single sign-on, end to end against a real OIDC provider: discovery, the
 * authorization redirect, the code exchange, and the account Trove KB creates.
 */

const PROJECT = process.env.E2E_COMPOSE_PROJECT ?? "trove-kb-test";
const NETWORK = process.env.E2E_DOCKER_NETWORK ?? `${PROJECT}_public`;
const REPO = process.env.E2E_REPO ?? process.cwd();
const SSO_EMAIL = "sso-user@example.com";

test.describe.configure({ mode: "serial" });

function restartApp(withOidc: boolean): void {
  // Recreating the app rereads ENV_FILE. Without it compose falls back to .env,
  // which quietly hands the test stack another deployment's settings and breaks
  // whatever runs after this file. Better to stop than to strip the container.
  if (!process.env.ENV_FILE) {
    throw new Error("Set ENV_FILE to the env file the test stack was started with, e.g. .env.test");
  }

  const files = withOidc
    ? ["-f", "docker-compose.yml", "-f", "e2e/oidc-override.yml"]
    : ["-f", "docker-compose.yml"];

  const env = {
    ...process.env,
    ...STACK_ENV,
    ...(withOidc
      ? {
          OIDC_ISSUER: ISSUER,
          OIDC_CLIENT_ID: CLIENT_ID,
          OIDC_CLIENT_SECRET: "trove-kb-e2e-secret",
        }
      : {}),
  };

  try {
    execFileSync(
      "docker",
      ["compose", "-p", PROJECT, ...files, "up", "-d", "--force-recreate", "app"],
      { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const err = error as { stderr?: Buffer };
    throw new Error(`compose up failed: ${String(err.stderr ?? error)}`);
  }

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

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  startMockOidc(NETWORK);
  restartApp(true);

  // First run completes setup, so /sign-in is reachable at all.
  const page = await browser.newPage();
  await signInAsAdmin(page);
  await page.close();

  // Start from no SSO account so the first sign-in is a real provisioning.
  psql(`delete from sessions where user_id in (select id from users where email = '${SSO_EMAIL}');`);
  psql(`delete from accounts where user_id in (select id from users where email = '${SSO_EMAIL}');`);
  psql(`delete from users where email = '${SSO_EMAIL}' and id not in (select user_id from audit_log where user_id is not null);`);
});

test.afterAll(() => {
  test.setTimeout(180_000);
  stopMockOidc();
  restartApp(false);
});

/** Fills the provider's login form with a subject and the claims Trove KB needs. */
async function signInAtProvider(page: Page, email: string) {
  await expect(page).toHaveURL((url) =>
    url.href.startsWith(`${MOCK_OIDC_ORIGIN}/default/authorize`),
  );
  await page.locator('input[name="username"]').fill(email);
  await page.locator('textarea[name="claims"]').fill(
    JSON.stringify({ email, email_verified: true, name: "SSO User" }),
  );
  await page.getByRole("button", { name: "Sign-in" }).click();
}

test("the sign-in page offers SSO once a provider is configured", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in with SSO" })).toBeVisible();
  await expect(page.getByText("Use single sign-on or a local account.")).toBeVisible();
  // Local sign-in is still there.
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("a new user can sign in through the provider", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with SSO" }).click();

  await signInAtProvider(page, SSO_EMAIL);

  await expect(page).toHaveURL(/\/companies/);
  // Identity lives in the account menu now.
  await openAccountMenu(page);
  await expect(page.getByText(SSO_EMAIL)).toBeVisible();

  // Provisioned with the default role and no secret access.
  expect(psql(`select role from users where email = '${SSO_EMAIL}';`)).toBe("tech");
  expect(psql(`select can_reveal_secrets from users where email = '${SSO_EMAIL}';`)).toBe("f");

  // Linked to the provider, with no password of its own.
  expect(
    psql(
      `select provider_id from accounts where user_id = ` +
        `(select id from users where email = '${SSO_EMAIL}');`,
    ),
  ).toBe("oidc");
  expect(
    psql(
      `select coalesce(password, 'none') from accounts where user_id = ` +
        `(select id from users where email = '${SSO_EMAIL}');`,
    ),
  ).toBe("none");
});

test("signing in again reuses the same account", async ({ page }) => {
  const before = psql(`select count(*) from users where email = '${SSO_EMAIL}';`);

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with SSO" }).click();
  await signInAtProvider(page, SSO_EMAIL);
  await expect(page).toHaveURL(/\/companies/);

  expect(psql(`select count(*) from users where email = '${SSO_EMAIL}';`)).toBe(before);
  expect(
    psql(
      `select count(*) from accounts where user_id = ` +
        `(select id from users where email = '${SSO_EMAIL}');`,
    ),
  ).toBe("1");
});

test("an SSO user gets the permissions of their role, nothing more", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with SSO" }).click();
  await signInAtProvider(page, SSO_EMAIL);
  await expect(page).toHaveURL(/\/companies/);

  // tech: no company creation, no admin screens.
  await expect(page.getByRole("link", { name: "New company" })).toHaveCount(0);

  const response = await page.goto("/admin/doc-types");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/companies$/);
});

test("the local sign-in form still works alongside SSO", async ({ page }) => {
  await page.goto("/sign-in");
  // The one account every spec shares, so a change to its password reaches here too.
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/companies/);
});
