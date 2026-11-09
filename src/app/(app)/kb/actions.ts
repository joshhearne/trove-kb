"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { checkbox, text, toFieldErrors, type FormState } from "@/lib/form";
import { getCompanyScope, hasRecentMfa, requireAdmin, requireRecentMfa, requireUser } from "@/server/auth/session";
import { readerKey } from "@/server/kb/identity";
import { RunbookStepError } from "@/server/kb/runbook";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { moveArticle, writeArticle } from "@/server/services/kb-write";
import { listCategories } from "@/server/services/kb";
import { setArticlePublicHidden } from "@/server/services/kb";
import { setFavorite, setVote } from "@/server/services/kb-reactions";
import { isAdministrator } from "@/server/auth/roles";
import { appWriter } from "@/server/kb/app-writer";
import {
  editTextArticle,
  recategorizeArticle,
  removeArticle,
  restoreArticle,
} from "@/server/services/kb-curate";

const UUID = /^[0-9a-f-]{36}$/i;

/** A signed-in reader keeping or rating an article, as the public site lets them. */
async function reacting(articleId: string | undefined) {
  if (!articleId || !UUID.test(articleId)) return null;
  const user = await requireUser();
  return { key: readerKey(user.email), reader: { scope: await getCompanyScope(user), via: "app" as const, userId: user.id } };
}

function refresh(articleId: string): void {
  revalidatePath(`/kb/articles/${articleId}`);
  revalidatePath("/kb");
}

export async function toggleFavoriteAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "article");
  const caller = await reacting(articleId);
  if (!caller || !articleId) return;
  try {
    await setFavorite(caller.key, articleId, formData.get("on") === "1", caller.reader);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  refresh(articleId);
}

export async function voteAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "article");
  const caller = await reacting(articleId);
  if (!caller || !articleId) return;
  const vote = text(formData, "vote");
  try {
    await setVote(caller.key, articleId, vote === "up" ? true : vote === "down" ? false : null, caller.reader);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  refresh(articleId);
}

export async function setArticlePublicHiddenAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  if (!id) return;

  const user = await requireAdmin();
  await setArticlePublicHidden(id, checkbox(formData, "hidden"), user.id);
  revalidatePath(`/kb/articles/${id}`);
}

/* ---------- Writing an article in the app ---------- */

/** The signed-in person as a writer: an administrator may write anywhere; anyone else where granted. */
async function writerFor() {
  return appWriter(await requireUser());
}

/** `kind-of-thing-3f9a`: a name for an article written here, stable for its life. */
function mintExternalId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const tail = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${slug || "article"}-${tail}`;
}

/** The categories and sections a collection already has, for the editor's dropdowns. */
export async function collectionCategoriesAction(
  collectionId: string,
): Promise<{ category: string | null; subcategory: string | null }[]> {
  if (!/^[0-9a-f-]{36}$/i.test(collectionId)) return [];
  const user = await requireUser();
  const rows = await listCategories(collectionId, { scope: await getCompanyScope(user), via: "app", userId: user.id });
  return rows.map((row) => ({ category: row.category, subcategory: row.subcategory }));
}

/**
 * Moving an article is an administrator's step with the second factor fresh:
 * this asks for it when it is not, and comes back to the editor unlocked.
 */
export async function unlockMoveAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "articleId") ?? "";
  if (!UUID.test(articleId)) return;
  const user = await requireAdmin();
  const back = `/kb/articles/${articleId}/edit?unlock=move`;
  await requireRecentMfa(user, back);
  redirect(back as Route);
}

export async function saveArticleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const collectionId = text(formData, "collectionId") ?? "";
  const fromCollectionId = text(formData, "fromCollectionId");
  const articleIdGiven = text(formData, "articleId");
  const existingId = text(formData, "externalId");
  const title = text(formData, "title") ?? "";
  let articleId: string;
  try {
    const writer = await writerFor();
    // A change of collection is a move, which only an administrator with a fresh second step may make.
    if (articleIdGiven && fromCollectionId && fromCollectionId !== collectionId) {
      const user = await requireUser();
      if (!isAdministrator(user.role) || !hasRecentMfa(user)) return { error: "Unlock moving with your second step first" };
      await moveArticle(articleIdGiven, collectionId, writer);
    }
    // A text file brought in by an import has no name of its own to write
    // under: its text is edited where it is, and the import leaves it be.
    if (articleIdGiven && !existingId) {
      await editTextArticle(
        articleIdGiven,
        {
          title,
          body: (formData.get("body") as string | null) ?? "",
          category: text(formData, "category") ?? null,
          subcategory: text(formData, "subcategory") ?? null,
        },
        writer,
      );
      revalidatePath(`/kb/${collectionId}`);
      if (fromCollectionId) revalidatePath(`/kb/${fromCollectionId}`);
      revalidatePath(`/kb/articles/${articleIdGiven}`);
      redirect(`/kb/articles/${articleIdGiven}` as Route);
    }
    const result = await writeArticle(
      {
        collectionId,
        externalId: existingId ?? mintExternalId(title),
        title,
        body: (formData.get("body") as string | null) ?? "",
        category: text(formData, "category"),
        subcategory: text(formData, "subcategory"),
        kind: checkbox(formData, "runbook") ? "runbook" : "article",
        publicHidden: checkbox(formData, "internalOnly"),
      },
      writer,
    );
    articleId = result.articleId;
  } catch (err) {
    if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
    if (err instanceof RunbookStepError) return { fieldErrors: { body: err.message } };
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/kb/${collectionId}`);
  if (fromCollectionId) revalidatePath(`/kb/${fromCollectionId}`);
  revalidatePath(`/kb/articles/${articleId}`);
  redirect(`/kb/articles/${articleId}`);
}

/* ---------- Tidying an article up: any article, however it came ---------- */

/** Files an article under a category and section. */
export async function recategorizeArticleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const articleId = text(formData, "articleId") ?? "";
  if (!UUID.test(articleId)) return { error: "Not found" };
  try {
    await requireAdmin();
    await recategorizeArticle(
      articleId,
      { category: text(formData, "category") ?? null, subcategory: text(formData, "subcategory") ?? null },
      await writerFor(),
    );
  } catch (err) {
    if (err instanceof ZodError) return { fieldErrors: toFieldErrors(err) };
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/kb/articles/${articleId}`);
  revalidatePath("/kb", "layout");
  return { ok: true };
}

/** Moves an article to another collection: an administrator's step, with the second factor fresh. */
export async function relocateArticleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const articleId = text(formData, "articleId") ?? "";
  const toCollectionId = text(formData, "collectionId") ?? "";
  if (!UUID.test(articleId) || !UUID.test(toCollectionId)) return { error: "Choose a collection" };
  const user = await requireAdmin();
  await requireRecentMfa(user, `/kb/articles/${articleId}#manage`);
  try {
    await moveArticle(articleId, toCollectionId, await writerFor());
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/kb/articles/${articleId}`);
  revalidatePath("/kb", "layout");
  return { ok: true };
}

/** Takes an article out of the knowledge base, and keeps its file out of later imports. */
export async function removeArticleAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "articleId") ?? "";
  const back = text(formData, "collectionId") ?? "";
  if (!UUID.test(articleId)) return;
  const user = await requireAdmin();
  await requireRecentMfa(user, `/kb/articles/${articleId}#manage`);
  await removeArticle(articleId, await writerFor());
  revalidatePath("/kb", "layout");
  redirect((UUID.test(back) ? `/kb/${back}` : "/kb") as Route);
}

/** Puts a removed article back. */
export async function restoreArticleAction(formData: FormData): Promise<void> {
  const articleId = text(formData, "articleId") ?? "";
  if (!UUID.test(articleId)) return;
  await requireAdmin();
  await restoreArticle(articleId, await writerFor());
  revalidatePath("/kb", "layout");
  revalidatePath("/admin/kb", "layout");
  redirect(`/kb/articles/${articleId}` as Route);
}

