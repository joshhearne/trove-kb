import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { kbArticles, kbImportExclusions } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { queueEvent } from "@/server/services/webhooks";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { getArticle, getCollection } from "@/server/services/kb";
import { applyVisibility } from "@/server/services/kb-visibility";
import {
  archiveArticle,
  readerFor,
  revisionActor,
  mayWrite,
  type KbWriter,
} from "@/server/services/kb-write";
import {
  clean,
  keepOriginal,
  originalOf,
  rewriteChunks,
} from "@/server/services/kb-import";
import { recordRevision } from "@/server/services/kb-revisions";
import { extractArticle, NotAnArticleError } from "@/server/kb/extract";
import { deriveRunbook } from "@/server/kb/runbook";
import { tidyImportedMarkdown } from "@/server/kb/tidy";

/**
 * Tidying up what an import brought in, one article at a time: where it
 * lives, what it is filed under, whether it belongs at all, and, for a text
 * file, what it says. Works on every article, however it came: a PDF from a
 * folder as much as one written here.
 *
 * Each change is kept in the article's history (kb_article_revisions), and
 * each removal, move or edit holds the file out of the next import of its
 * old collection (kb_import_exclusions), so a re-import does not undo it.
 */

/** Text files are edited in the editor; anything else is replaced by a new file. */
export const TEXT_SOURCE_TYPES = ["md", "txt"] as const;

export function isTextArticle(sourceType: string): boolean {
  return (TEXT_SOURCE_TYPES as readonly string[]).includes(sourceType);
}

const name = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

export const placementSchema = z.object({ category: name, subcategory: name });

export const textEditSchema = z.object({
  title: z.string().trim().min(1, "Give it a title").max(500),
  body: z.string().max(1_000_000),
  category: name,
  subcategory: name,
});

/** The article as it stands, with the key an import knows it by. */
async function curatable(articleId: string, writer: KbWriter) {
  const article = await getArticle(articleId, readerFor(writer));
  if (!article) throw new NotFoundError("Article");
  if (!mayWrite(writer, article.collectionId)) {
    throw new ForbiddenError(`You may read "${article.collectionName}" but not change it.`);
  }
  const [row] = await db
    .select({ sourceKey: kbArticles.sourceKey, contentHash: kbArticles.contentHash })
    .from(kbArticles)
    .where(eq(kbArticles.id, articleId))
    .limit(1);
  return { ...article, sourceKey: row!.sourceKey, contentHash: row!.contentHash };
}

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function holdOut(
  tx: Executor,
  collectionId: string,
  sourceKey: string,
  reason: "removed" | "moved" | "edited",
  articleId: string,
  writer: KbWriter,
): Promise<void> {
  const createdBy = writer.via === "app" ? writer.userId : null;
  await tx
    .insert(kbImportExclusions)
    .values({ collectionId, sourceKey, reason, articleId, createdBy })
    .onConflictDoUpdate({
      target: [kbImportExclusions.collectionId, kbImportExclusions.sourceKey],
      set: { reason, articleId, createdBy, createdAt: new Date() },
    });
}

function attribution(writer: KbWriter): Record<string, unknown> {
  return writer.via === "app"
    ? { via: "app", userId: writer.userId, userName: writer.userName }
    : { via: writer.via, apiKeyId: writer.keyId, apiKeyName: writer.keyName };
}

/** Files an article under a category and section. An import keeps them from now on. */
export async function recategorizeArticle(
  articleId: string,
  input: z.input<typeof placementSchema>,
  writer: KbWriter,
): Promise<void> {
  const { category, subcategory } = placementSchema.parse(input);
  const article = await curatable(articleId, writer);
  const next = { category: category ?? null, subcategory: category ? (subcategory ?? null) : null };
  if (next.category === article.category && next.subcategory === article.subcategory) return;

  await db.transaction(async (tx) => {
    await tx
      .update(kbArticles)
      .set({ ...next, placedManually: true, updatedAt: new Date() })
      .where(eq(kbArticles.id, articleId));
    // A category can be hidden from the public site; the article follows it.
    await applyVisibility(article.collectionId, articleId, tx);
    await recordRevision("recategorized", { ...article, body: null }, revisionActor(writer), next, tx);
    await writeAudit(
      {
        action: "kb_article.recategorized",
        entity: "kb_article",
        entityId: articleId,
        detail: {
          collectionId: article.collectionId,
          title: article.title,
          from: { category: article.category, subcategory: article.subcategory },
          to: next,
          ...attribution(writer),
        },
      },
      tx,
    );
    await queueEvent(
      "kb.article.upserted",
      { collection_id: article.collectionId, article_id: articleId, external_id: article.externalId, kind: article.kind },
      tx,
    );
  });
}

/**
 * Takes an article out of the knowledge base: readers and search lose it, and
 * the next import of its collection leaves the file out. It can be restored.
 */
export async function removeArticle(articleId: string, writer: KbWriter): Promise<void> {
  const article = await curatable(articleId, writer);
  await archiveArticle(articleId, writer);
  await db.transaction(async (tx) => {
    await holdOut(tx, article.collectionId, article.sourceKey, "removed", articleId, writer);
    await recordRevision("removed", { ...article, body: null }, revisionActor(writer), {}, tx);
  });
}

export type RemovedArticle = {
  id: string;
  title: string;
  sourcePath: string | null;
  sourceType: string;
  removedAt: Date;
};

/** What was removed from a collection, newest first, for putting back. */
export async function listRemovedArticles(collectionId: string, writer: KbWriter): Promise<RemovedArticle[]> {
  const collection = await getCollection(collectionId, readerFor(writer));
  if (!collection) return [];
  return db
    .select({
      id: kbArticles.id,
      title: kbArticles.title,
      sourcePath: kbArticles.sourcePath,
      sourceType: kbArticles.sourceType,
      removedAt: kbImportExclusions.createdAt,
    })
    .from(kbImportExclusions)
    .innerJoin(kbArticles, eq(kbArticles.id, kbImportExclusions.articleId))
    .where(
      and(
        eq(kbImportExclusions.collectionId, collectionId),
        eq(kbImportExclusions.reason, "removed"),
        eq(kbArticles.collectionId, collectionId),
        isNotNull(kbArticles.archivedAt),
      ),
    )
    .orderBy(desc(kbImportExclusions.createdAt))
    .limit(200);
}

/** Puts a removed article back, and lets imports bring its file again. */
export async function restoreArticle(articleId: string, writer: KbWriter): Promise<string> {
  const [row] = await db
    .select({
      id: kbArticles.id,
      collectionId: kbArticles.collectionId,
      sourceKey: kbArticles.sourceKey,
      title: kbArticles.title,
      category: kbArticles.category,
      subcategory: kbArticles.subcategory,
      externalId: kbArticles.externalId,
      kind: kbArticles.kind,
      archivedAt: kbArticles.archivedAt,
    })
    .from(kbArticles)
    .where(eq(kbArticles.id, articleId))
    .limit(1);
  // One in a collection this writer cannot see is not found, whatever its state.
  const collection = row ? await getCollection(row.collectionId, readerFor(writer)) : null;
  if (!row || !collection || !row.archivedAt) throw new NotFoundError("Article");
  if (!mayWrite(writer, row.collectionId)) {
    throw new ForbiddenError(`You may read "${collection.name}" but not change it.`);
  }

  await db.transaction(async (tx) => {
    await tx.update(kbArticles).set({ archivedAt: null, updatedAt: new Date() }).where(eq(kbArticles.id, articleId));
    await tx
      .delete(kbImportExclusions)
      .where(
        and(
          eq(kbImportExclusions.collectionId, row.collectionId),
          eq(kbImportExclusions.sourceKey, row.sourceKey),
          eq(kbImportExclusions.reason, "removed"),
        ),
      );
    await applyVisibility(row.collectionId, articleId, tx);
    await recordRevision("restored", row, revisionActor(writer), {}, tx);
    await writeAudit(
      {
        action: "kb_article.restored",
        entity: "kb_article",
        entityId: articleId,
        detail: { collectionId: row.collectionId, title: row.title, ...attribution(writer) },
      },
      tx,
    );
    await queueEvent(
      "kb.article.upserted",
      { collection_id: row.collectionId, article_id: articleId, external_id: row.externalId, kind: row.kind },
      tx,
    );
  });
  return row.collectionId;
}

/**
 * Edits the text of an article that came from a text file (.md, .txt). The
 * import that brought it leaves it alone from now on, so the edit stands.
 */
export async function editTextArticle(
  articleId: string,
  input: z.input<typeof textEditSchema>,
  writer: KbWriter,
): Promise<void> {
  const data = textEditSchema.parse(input);
  const article = await curatable(articleId, writer);
  if (!isTextArticle(article.sourceType)) {
    throw new ForbiddenError("Only a text file is edited here. Upload a new version of this file instead.");
  }

  // A browser sends a textarea with Windows line endings; files here use \n.
  let body = clean(data.body.replace(/\r\n?/g, "\n"));
  let steps = article.steps;
  if (article.kind === "runbook" && article.format === "markdown") {
    const derived = deriveRunbook(body, article.steps);
    body = derived.body;
    steps = derived.steps;
  }
  const title = clean(data.title);
  const category = data.category ?? null;
  const subcategory = category ? (data.subcategory ?? null) : null;
  const moved = category !== article.category || subcategory !== article.subcategory;
  const extraction = body.replace(/\s/g, "") === "" ? "unextracted" : "ok";

  await db.transaction(async (tx) => {
    await tx
      .update(kbArticles)
      .set({
        title,
        body,
        steps,
        category,
        subcategory,
        extraction,
        ...(moved ? { placedManually: true } : {}),
        metadata: { ...article.metadata, edited_by: writer.via === "app" ? writer.userName : writer.keyName },
        dateModified: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(kbArticles.id, articleId));
    await rewriteChunks(tx, articleId, article.collectionId, title, body, extraction);
    await applyVisibility(article.collectionId, articleId, tx);
    await holdOut(tx, article.collectionId, article.sourceKey, "edited", articleId, writer);
    await recordRevision("edited", article, revisionActor(writer), {}, tx);
    await writeAudit(
      {
        action: "kb_article.updated",
        entity: "kb_article",
        entityId: articleId,
        detail: { collectionId: article.collectionId, title, edited: true, ...attribution(writer) },
      },
      tx,
    );
    await queueEvent(
      "kb.article.upserted",
      { collection_id: article.collectionId, article_id: articleId, external_id: article.externalId, kind: article.kind },
      tx,
    );
  });
}

/** Thrown when an uploaded file is not one the knowledge base takes. */
export class NotAcceptedFileError extends Error {}

/**
 * Replaces the file an article was made from with a new version: its text is
 * read again and the file kept, while the old text and file stay in the
 * article's history. The title and where it is filed stay as they are, and the
 * import that brought the old file leaves this one alone.
 */
export async function replaceArticleFile(
  articleId: string,
  filename: string,
  bytes: Buffer,
  writer: KbWriter,
): Promise<void> {
  const article = await curatable(articleId, writer);

  let extracted;
  try {
    extracted = await extractArticle(filename, bytes);
  } catch (error) {
    if (error instanceof NotAnArticleError) {
      throw new NotAcceptedFileError(
        "That file is not one the knowledge base takes: use a PDF, a Word document (.docx), HTML, Markdown, or text.",
      );
    }
    throw new NotAcceptedFileError("That file could not be read.");
  }

  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const original = await keepOriginal(article.collectionId, filename, bytes, extracted.sourceType, contentHash);
  const previousOriginal = originalOf(article.metadata);
  const body = clean(extracted.format === "markdown" ? tidyImportedMarkdown(extracted.body) : extracted.body);
  const { original: _dropped, ...metadata } = article.metadata;
  void _dropped;

  await db.transaction(async (tx) => {
    await tx
      .update(kbArticles)
      .set({
        body,
        format: extracted.format,
        sourceType: extracted.sourceType,
        extraction: extracted.extraction,
        contentHash,
        metadata: {
          ...metadata,
          ...(original ? { original } : {}),
          replaced_by: writer.via === "app" ? writer.userName : writer.keyName,
        },
        dateModified: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(kbArticles.id, articleId));
    await rewriteChunks(tx, articleId, article.collectionId, article.title, body, extracted.extraction);
    await holdOut(tx, article.collectionId, article.sourceKey, "edited", articleId, writer);
    await recordRevision(
      "replaced",
      { ...article, body: article.body, original: previousOriginal },
      revisionActor(writer),
      { file: filename, bytes: bytes.byteLength },
      tx,
    );
    await writeAudit(
      {
        action: "kb_article.replaced",
        entity: "kb_article",
        entityId: articleId,
        detail: {
          collectionId: article.collectionId,
          title: article.title,
          file: filename,
          bytes: bytes.byteLength,
          ...attribution(writer),
        },
      },
      tx,
    );
    await queueEvent(
      "kb.article.upserted",
      { collection_id: article.collectionId, article_id: articleId, external_id: article.externalId, kind: article.kind },
      tx,
    );
  });
}
