import { expect, test } from "@playwright/test";
import { psql } from "./db";
import { signInAsAdmin, unique } from "./support";

/**
 * Tidying up what an import brought in: an article that came from a file, with
 * no id of its own, is filed, edited (a text file), moved, removed and put
 * back by an administrator, and each step lands in its history and in the
 * list the next import of the collection leaves alone.
 */

let fromId = "";
let toName = "";
let articleId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  fromId = psql(`insert into kb_collections (name) values ('${unique("Imported")}') returning id;`).split("\n")[0]!;
  toName = unique("Tidy");
  psql(`insert into kb_collections (name) values ('${toName}');`);
  articleId = psql(
    `insert into kb_articles (collection_id, source_key, source_path, title, body, format, source_type, category, content_hash) ` +
      `values ('${fromId}', 'path:Network/notes.txt', 'Network/notes.txt', 'switch notes', 'Uplinks on 47 and 48.', 'text', 'txt', 'Network', 'h1') returning id;`,
  ).split("\n")[0]!;
});

test("an imported file is filed under a category that later imports keep", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/kb/articles/${articleId}`);
  const manage = page.locator("#manage");
  await manage.getByLabel("Category").fill("Switching");
  await manage.getByLabel("Section").fill("Core");
  await manage.getByRole("button", { name: "Save category" }).click();
  await expect(manage.getByText("Filed.")).toBeVisible();
  await expect
    .poll(() => psql(`select category || '/' || subcategory || '/' || placed_manually from kb_articles where id = '${articleId}';`))
    .toBe("Switching/Core/true");
});

test("an imported text file opens in the editor, and the import leaves the edit alone", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/kb/articles/${articleId}`);
  await expect(page.locator("#manage").getByText("This is a text file")).toBeVisible();
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.locator("textarea[name=body]").fill("Uplinks on 49 and 50.");
  await page.getByRole("button", { name: /^Save/ }).click();
  await expect(page).toHaveURL(new RegExp(`/kb/articles/${articleId}$`));
  await expect(page.getByText("Uplinks on 49 and 50.")).toBeVisible();
  expect(psql(`select reason from kb_import_exclusions where article_id = '${articleId}';`)).toBe("edited");
  await expect(page.locator("#manage").getByText("Text edited")).toBeVisible();
});

test("removing takes it out of the collection, and restoring puts it back", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/kb/articles/${articleId}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#manage").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/kb/${fromId}$`));
  expect(psql(`select reason from kb_import_exclusions where article_id = '${articleId}';`)).toBe("removed");
  await page.goto(`/kb/articles/${articleId}`);
  await expect(page.getByText("switch notes")).toHaveCount(0);

  await page.goto(`/admin/kb/${fromId}`);
  const row = page.getByRole("listitem").filter({ hasText: "Network/notes.txt" });
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(page).toHaveURL(new RegExp(`/kb/articles/${articleId}$`));
  expect(psql(`select count(*) from kb_import_exclusions where article_id = '${articleId}';`)).toBe("0");
});

test("moving it to another collection keeps the old one's next import from bringing it back", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto(`/kb/articles/${articleId}`);
  const manage = page.locator("#manage");
  await manage.getByLabel("Collection").selectOption({ label: toName });
  await manage.getByRole("button", { name: "Move", exact: true }).click();
  await expect(manage.getByText("Moved.")).toBeVisible();
  expect(psql(`select reason from kb_import_exclusions where collection_id = '${fromId}' and source_key = 'path:Network/notes.txt';`)).toBe("moved");
  await page.reload();
  await expect(page.locator("#manage").getByText("Moved", { exact: true })).toBeVisible();
});
