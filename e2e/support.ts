import { expect, type Page } from "@playwright/test";
import { psql } from "./db";

/**
 * What a spec that recreates the app container must hand compose. The base
 * file takes APP_URL from the shell, and compose fills a missing one from
 * .env, which on a host that also runs a deployment is its https address:
 * the app would then set Secure cookies over plain http, and every spec after
 * it that fetches with page.request would be signed out.
 */
export const STACK_ENV = {
  APP_PORT: "3090",
  APP_URL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3090",
};

export const ADMIN = {
  email: "e2e-admin@example.com",
  password: "Correct horse battery 7!",
  name: "E2E Admin",
};

/**
 * Clears the instance's chosen language, so en-US is what renders. Any spec
 * that asserts US spelling needs this: the setting is instance-wide, one
 * database serves the whole run, and a spec that exercises the dropdown leaves
 * its last choice behind.
 */
export function clearInstanceLocale(): void {
  psql("update instance_settings set default_locale = '';");
}

/** A suffix that keeps each run's records apart in a database that persists. */
export function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`;
}

/** First run creates the admin; later runs just sign in. */
export async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/");

  if (page.url().includes("/setup")) {
    await page.getByLabel("Your name").fill(ADMIN.name);
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
    await page.getByLabel("Confirm password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Create admin account" }).click();
  } else {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }

  await expect(page).toHaveURL(/\/companies/);
}

/** Signs in as somebody other than the admin. */
export async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/companies/);
}

export async function createOptionList(page: Page, name: string, items: string[]): Promise<void> {
  await page.goto("/admin/option-lists");
  await page.getByLabel("List name").fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page).toHaveURL(/\/admin\/option-lists\/[0-9a-f-]{36}/);

  for (const item of items) {
    await page.getByLabel("New option").fill(item);
    await page.getByRole("button", { name: "Add option" }).click();
    await expect(page.getByText(item, { exact: true })).toBeVisible();
  }
}

export async function createDocType(
  page: Page,
  name: string,
  fields: { label: string; type: string; optionList?: string }[],
): Promise<string> {
  await page.goto("/admin/doc-types/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Scope").selectOption("company");
  await page.getByRole("button", { name: "Create doc type" }).click();
  await expect(page).toHaveURL(/\/admin\/doc-types\/[0-9a-f-]{36}/);
  const docTypeId = page.url().split("/").pop() as string;

  for (const field of fields) {
    await page.getByLabel("Label").fill(field.label);
    await page.getByLabel("Type").selectOption(field.type);
    if (field.optionList) {
      await page.getByLabel("Option list").selectOption({ label: field.optionList });
    }
    await page.getByRole("button", { name: "Add field" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: field.label })).toBeVisible();
  }

  return docTypeId;
}

export async function createCompany(page: Page, name: string): Promise<string> {
  await page.goto("/companies/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() as string;
}

export async function createDocument(
  page: Page,
  companyId: string,
  docTypeName: string,
  title: string,
): Promise<string> {
  await page.goto(`/companies/${companyId}/documents/new`);
  await page.getByRole("link", { name: docTypeName }).click();
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop() as string;
}

/**
 * Drags one field handle above another. The list re-renders as the drop lands,
 * so wait for it to settle before the caller clicks anything.
 */
export async function dragFieldAbove(page: Page, sourceIndex: number, targetIndex: number) {
  const handles = page.getByRole("button", { name: /^Reorder / });
  const source = handles.nth(sourceIndex);
  const target = handles.nth(targetIndex);

  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("missing drag handles");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Clear the sensor's activation distance first, then travel.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 8, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y - 12, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByRole("group", { name: "Apply new field order" })).toBeVisible();
  await page.waitForTimeout(150);
}

/**
 * Opens the account flyout, where a reader's own settings live. Retries
 * because changing the language refreshes the tree, which closes the menu.
 */
export async function openAccountMenu(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: /^Account menu for / });
  const panel = page.getByRole("dialog", { name: "Account" });

  await expect(async () => {
    if ((await panel.count()) === 0) await trigger.click();
    await expect(panel).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
