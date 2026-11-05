import { expect, test } from "@playwright/test";
import { psql } from "./db";
import { ADMIN, signInAsAdmin } from "./support";

/**
 * Updates: Admin -> System health, and the What's new pop-up after a release.
 * The release is written straight to the database, as a build's change files
 * would be on boot, and removed again so no other spec meets the pop-up.
 */

const ENTRY = "e2e-whats-new";
let releaseId = "";

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  psql(`delete from change_releases where id in (select release_id from change_entries where id = '${ENTRY}');`);
  psql("update update_settings set channel = 'manual', update_requested_at = null;");
});

test("the pop-up shows a new release once", async ({ page }) => {
  await signInAsAdmin(page);

  releaseId = psql("insert into change_releases (version) values ('dev-e2e0001') returning id;").split("\n")[0]!;
  psql(
    `insert into change_entries (id, release_id, kind, audience, items) values ` +
      `('${ENTRY}', ${releaseId}, 'feature', 'everyone', '["Imported articles keep their **numbered steps**."]');`,
  );

  await page.goto("/companies");
  const dialog = page.getByRole("dialog", { name: "What's new: dev-e2e0001" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("numbered steps")).toBeVisible();
  await expect(dialog.getByText("New feature")).toBeVisible();

  await dialog.getByRole("button", { name: "Got it" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => psql(`select whats_new_seen_release_id from users where email = '${ADMIN.email}';`))
    .toBe(releaseId);

  await page.reload();
  await expect(page.getByRole("dialog", { name: /What's new/ })).toHaveCount(0);
});

test("System health shows the build, the channel, and the history", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/admin/system");

  await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build info" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Updates" })).toBeVisible();
  // No updater on the test stack: it says how to install one.
  await expect(page.getByText("The host updater isn't installed")).toBeVisible();
  // The release from the first test, in the history.
  await expect(page.getByText("dev-e2e0001")).toBeVisible();

  await page.getByRole("radio", { name: /Development/ }).check();
  await expect(page.getByText("Update settings saved")).toBeVisible();
  await expect.poll(() => psql("select channel from update_settings;")).toBe("development");
  await expect(page.getByLabel("Update hour", { exact: true })).toBeVisible();

  await page.getByLabel("Update hour", { exact: true }).selectOption("4");
  await expect.poll(() => psql("select update_hour from update_settings;")).toBe("4");
  await expect
    .poll(() => psql("select count(*) from audit_log where action = 'updates.policy_changed';"))
    .not.toBe("0");
});
