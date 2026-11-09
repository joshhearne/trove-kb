import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { kbArticles, kbChunks, kbCollections, kbImages, kbImportExclusions } from "@/server/db/schema";
import { picturesOf } from "@/server/services/kb-images";
import { writeAudit } from "@/server/services/audit";
import { applyVisibility } from "@/server/services/kb-visibility";
import { queueEvent } from "@/server/services/webhooks";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { getArticle, getCollection, type KbReader } from "@/server/services/kb";
import { ARTICLE_KINDS } from "@/server/kb/extract";
import { sourceKey, storeArticle } from "@/server/services/kb-import";
import { safeUrl } from "@/server/kb/extract";
import { grantsForUser, type KbGrant } from "@/server/services/kb-grants";
import { recordRevision, type RevisionActor } from "@/server/services/kb-revisions";
import type { CompanyScope } from "@/server/auth/company-scope";
import { can } from "@/server/auth/roles";

/**
 * Writing to the knowledge base from outside the interface: an application's
 * own tooling keeping its own documentation current. A key writes only to the
 * collections an administrator granted it, and every change is an audit entry
 * naming the key that made it.
 *
 * An article is matched on the `external_id` its author gives it, so writing
 * the same article again replaces it. Nothing is ever deleted: an article
 * that no longer applies is archived.
 */

/**
 * Who is writing: an API key with its grants, or a signed-in person. An
 * administrator may write to any collection; anyone else needs a grant.
 */
export type KbWriter = {
  scope: CompanyScope;
  grants: readonly KbGrant[];
} & (
  | { via: "mcp" | "api"; keyId: string; keyName: string }
  | { via: "app"; userId: string; userName: string; admin: boolean }
);

/** Generous for prose, small next to what a request is allowed to carry. */
const MAX_BODY_CHARS = 1_000_000;

export const articleWriteSchema = z.object({
  collectionId: z.uuid(),
  /**
   * The author's own name for the article, stable across rewrites: a slug
   * such as `billing/refunds`. It is what makes a second write an update.
   */
  externalId: z
    .string()
    .trim()
    .min(1, "external_id is required")
    .max(200)
    .regex(/^[^\u0000-\u001f]+$/, "external_id cannot contain control characters"),
  title: z.string().trim().min(1, "title is required").max(500),
  body: z.string().max(MAX_BODY_CHARS, "body is too long").refine((value) => value.trim() !== "", {
    message: "body is required",
  }),
  category: z.string().trim().min(1).max(200).optional(),
  subcategory: z.string().trim().min(1).max(200).optional(),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((value) => safeUrl(value) !== null, "source_url must be an http or https address")
    .optional(),
  /** True keeps the article off the public site. Left out, it stays as it was. */
  publicHidden: z.boolean().optional(),
  /** A runbook's steps are derived from its body on save. Left out, an article. */
  kind: z.enum(ARTICLE_KINDS).optional(),
});

export function readerFor(writer: Pick<KbWriter, "scope" | "grants"> & { via?: KbWriter["via"] }): KbReader {
  return {
    scope: writer.scope,
    // A key reads by its grants; only the MCP door is one a collection can close.
    via: writer.via ?? "mcp",
    granted: writer.grants.filter((grant) => grant.canRead).map((grant) => grant.collectionId),
  };
}

export function mayWrite(writer: Pick<KbWriter, "grants"> & { via?: KbWriter["via"]; admin?: boolean }, collectionId: string): boolean {
  if (writer.via === "app" && writer.admin) return true;
  return writer.grants.some((grant) => grant.collectionId === collectionId && grant.canWrite);
}

function attribution(writer: KbWriter): Record<string, unknown> {
  return writer.via === "app"
    ? { via: "app", userId: writer.userId, userName: writer.userName }
    : { via: writer.via, apiKeyId: writer.keyId, apiKeyName: writer.keyName };
}

function writerName(writer: KbWriter): string {
  return writer.via === "app" ? writer.userName : writer.keyName;
}

/** The writer as an article's history names it. */
export function revisionActor(writer: KbWriter): RevisionActor {
  return writer.via === "app"
    ? { userId: writer.userId, name: writer.userName }
    : { userId: null, name: writer.keyName };
}

/**
 * The collection, if this key may write to it. One it cannot see is not
 * found; one it can see and may not change is forbidden, and says why,
 * because the fix is a setting somebody can go and change.
 */
async function writable(collectionId: string, writer: KbWriter) {
  const collection = await getCollection(collectionId, readerFor(writer));
  if (!collection) throw new NotFoundError("Collection");
  if (!mayWrite(writer, collectionId)) {
    throw new ForbiddenError(
      writer.via === "app"
        ? `You may read "${collection.name}" but not change it.`
        : `This key may read "${collection.name}" but not change it. An administrator can allow that under Admin → Knowledge base.`,
    );
  }
  return collection;
}

export type WriteResult = { articleId: string; outcome: "created" | "updated" | "unchanged" };

export async function writeArticle(
  input: z.input<typeof articleWriteSchema>,
  writer: KbWriter,
): Promise<WriteResult> {
  const data = articleWriteSchema.parse(input);
  await writable(data.collectionId, writer);

  const key = sourceKey(data.externalId, data.externalId);
  const sourceUrl = data.sourceUrl ? safeUrl(data.sourceUrl) : null;

  // Everything a reader would see, so a change to any of it is a change.
  const contentHash = createHash("sha256")
    .update(
      JSON.stringify([
        data.title,
        data.body,
        data.category ?? null,
        data.subcategory ?? null,
        sourceUrl,
      ]),
    )
    .digest("hex");

  const [existing] = await db
    .select({
      id: kbArticles.id,
      contentHash: kbArticles.contentHash,
      archivedAt: kbArticles.archivedAt,
      dateCreated: kbArticles.dateCreated,
      publicHidden: kbArticles.publicHidden,
      title: kbArticles.title,
      body: kbArticles.body,
      category: kbArticles.category,
      subcategory: kbArticles.subcategory,
    })
    .from(kbArticles)
    .where(and(eq(kbArticles.collectionId, data.collectionId), eq(kbArticles.sourceKey, key)))
    .limit(1);

  const unchanged = existing && !existing.archivedAt && existing.contentHash === contentHash;
  const hiddenChanged =
    data.publicHidden !== undefined && existing?.publicHidden !== data.publicHidden;

  if (unchanged && !hiddenChanged) return { articleId: existing.id, outcome: "unchanged" };

  const now = new Date();
  const articleId = await storeArticle(
    data.collectionId,
    key,
    null,
    {
      title: data.title,
      body: data.body,
      format: "markdown",
      sourceType: "md",
      extraction: "ok",
      kind: data.kind ?? "article",
      externalId: data.externalId,
      sourceUrl,
      category: data.category ?? null,
      subcategory: data.subcategory ?? null,
      dateCreated: existing?.dateCreated ?? now,
      dateModified: now,
      metadata: { written_by: writerName(writer) },
    },
    contentHash,
    { writerPlaces: true },
  );

  // What it said before, for its history. A change of the public setting alone is not an edit.
  if (existing && !unchanged) {
    await recordRevision(
      "edited",
      {
        id: existing.id,
        collectionId: data.collectionId,
        title: existing.title,
        category: existing.category,
        subcategory: existing.subcategory,
        body: existing.body,
      },
      revisionActor(writer),
    );
  }

  if (data.publicHidden !== undefined) {
    await db
      .update(kbArticles)
      .set({ publicHidden: data.publicHidden, hiddenBy: data.publicHidden ? "manual" : null })
      .where(eq(kbArticles.id, articleId));
    // Meant for the public site, it is still held if a rule or its category holds it.
    if (!data.publicHidden) await applyVisibility(data.collectionId, articleId);
  }

  await writeAudit({
    action: existing ? "kb_article.updated" : "kb_article.created",
    entity: "kb_article",
    entityId: articleId,
    detail: {
      collectionId: data.collectionId,
      externalId: data.externalId,
      title: data.title,
      ...(data.publicHidden !== undefined ? { publicHidden: data.publicHidden } : {}),
      ...attribution(writer),
    },
  });
  await queueEvent("kb.article.upserted", {
    collection_id: data.collectionId,
    article_id: articleId,
    external_id: data.externalId,
    kind: data.kind ?? "article",
  });

  return { articleId, outcome: existing ? "updated" : "created" };
}

/** The live article a collection holds under an external id, as the writer may see it. */
export async function findArticleByExternalId(
  collectionId: string,
  externalId: string,
  writer: KbWriter,
): Promise<string | null> {
  const collection = await getCollection(collectionId, readerFor(writer));
  if (!collection) return null;
  const [row] = await db
    .select({ id: kbArticles.id })
    .from(kbArticles)
    .where(
      and(
        eq(kbArticles.collectionId, collectionId),
        eq(kbArticles.sourceKey, sourceKey(externalId, externalId)),
        isNull(kbArticles.archivedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Hides an article from readers and from search. It can be written again. */
export async function archiveArticle(articleId: string, writer: KbWriter): Promise<void> {
  const [article] = await db
    .select({
      id: kbArticles.id,
      collectionId: kbArticles.collectionId,
      externalId: kbArticles.externalId,
      title: kbArticles.title,
      kind: kbArticles.kind,
    })
    .from(kbArticles)
    .where(and(eq(kbArticles.id, articleId), isNull(kbArticles.archivedAt)))
    .limit(1);
  if (!article) throw new NotFoundError("Article");

  try {
    await writable(article.collectionId, writer);
  } catch (error) {
    // Which collection an article is in is not this key's to learn.
    if (error instanceof NotFoundError) throw new NotFoundError("Article");
    throw error;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(kbArticles)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(kbArticles.id, article.id));

    await writeAudit(
      {
        action: "kb_article.archived",
        entity: "kb_article",
        entityId: article.id,
        detail: {
          collectionId: article.collectionId,
          externalId: article.externalId,
          title: article.title,
          ...attribution(writer),
        },
      },
      tx,
    );
    await queueEvent(
      "kb.article.archived",
      {
        collection_id: article.collectionId,
        article_id: article.id,
        external_id: article.externalId,
        kind: article.kind,
      },
      tx,
    );
  });
}

/** Whether a signed-in person may write to a collection: an administrator anywhere, others where granted. */
export async function userMayWrite(user: { id: string; role: string }, collectionId: string): Promise<boolean> {
  if (can(user.role, "kb.write")) return true;
  return (await grantsForUser(user.id)).some((grant) => grant.collectionId === collectionId && grant.canWrite);
}

/**
 * Moves an article to another collection, with the pictures it refers to:
 * a picture belongs to a collection, so each one the article uses is held
 * in the new collection too, under the same stored file. The new
 * collection's hide rules apply on arrival, and the next import of the old
 * collection leaves the file out (kb_import_exclusions) rather than making a
 * second copy there.
 */
export async function moveArticle(articleId: string, toCollectionId: string, writer: KbWriter): Promise<void> {
  const reader = readerFor(writer);
  const article = await getArticle(articleId, reader);
  if (!article) throw new NotFoundError("Article");
  if (article.collectionId === toCollectionId) return;
  await writable(article.collectionId, writer);
  const target = await writable(toCollectionId, writer);

  const pictures = await picturesOf(article);
  await db.transaction(async (tx) => {
    const [clash] = await tx
      .select({ id: kbArticles.id })
      .from(kbArticles)
      .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
      .where(and(eq(kbArticles.collectionId, toCollectionId), eq(kbArticles.sourceKey, sql`(select source_key from kb_articles where id = ${articleId})`)))
      .limit(1);
    if (clash) throw new ForbiddenError(`"${target.name}" already holds an article with this name`);

    const [moved] = await tx
      .update(kbArticles)
      .set({ collectionId: toCollectionId, updatedAt: new Date() })
      .where(eq(kbArticles.id, articleId))
      .returning({ sourceKey: kbArticles.sourceKey });
    await tx.update(kbChunks).set({ collectionId: toCollectionId }).where(eq(kbChunks.articleId, articleId));

    // The next import of the old collection must not bring the file back
    // there; arriving here, nothing holds it out any more.
    const userId = writer.via === "app" ? writer.userId : null;
    await tx
      .insert(kbImportExclusions)
      .values({ collectionId: article.collectionId, sourceKey: moved!.sourceKey, reason: "moved", articleId, createdBy: userId })
      .onConflictDoUpdate({
        target: [kbImportExclusions.collectionId, kbImportExclusions.sourceKey],
        set: { reason: "moved", articleId, createdBy: userId, createdAt: new Date() },
      });
    await tx
      .delete(kbImportExclusions)
      .where(and(eq(kbImportExclusions.collectionId, toCollectionId), eq(kbImportExclusions.sourceKey, moved!.sourceKey)));
    await recordRevision(
      "moved",
      {
        id: articleId,
        collectionId: article.collectionId,
        title: article.title,
        category: article.category,
        subcategory: article.subcategory,
      },
      revisionActor(writer),
      { from: article.collectionName, to: target.name },
      tx,
    );

    if (pictures.size > 0) {
      const rows = await tx
        .select()
        .from(kbImages)
        .where(inArray(kbImages.id, [...pictures.values()]));
      if (rows.length > 0) {
        await tx
          .insert(kbImages)
          .values(
            rows.map((row) => ({
              collectionId: toCollectionId,
              sourcePath: row.sourcePath,
              storageKey: row.storageKey,
              mimeType: row.mimeType,
              sizeBytes: row.sizeBytes,
              contentHash: row.contentHash,
            })),
          )
          .onConflictDoNothing();
      }
    }

    await applyVisibility(toCollectionId, articleId, tx);
    await writeAudit(
      {
        action: "kb_article.moved",
        entity: "kb_article",
        entityId: articleId,
        detail: {
          from: { id: article.collectionId, name: article.collectionName },
          to: { id: toCollectionId, name: target.name },
          externalId: article.externalId,
          title: article.title,
          ...attribution(writer),
        },
      },
      tx,
    );
    await queueEvent(
      "kb.article.upserted",
      { collection_id: toCollectionId, article_id: articleId, external_id: article.externalId, kind: article.kind },
      tx,
    );
  });
}
