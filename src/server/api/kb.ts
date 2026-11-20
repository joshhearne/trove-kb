import "server-only";
import { z } from "zod";
import type { AuthenticatedKey } from "@/server/services/api-keys";
import type { KbReader, ArticleSummary, ArticleDetail, KbHit, CollectionRow } from "@/server/services/kb";
import { mayWrite, type KbWriter } from "@/server/services/kb-write";
import { publicAddressFor } from "@/server/kb/share";
import { readerKey } from "@/server/kb/identity";
import { readerReaction, reactionCounts, type FavoriteRow } from "@/server/services/kb-reactions";
import { ARTICLE_KINDS } from "@/server/kb/extract";
import { env } from "@/lib/env";
import { wikilinksToMarkdown, type WikilinkIndex } from "@/lib/wikilinks";
import { resolveWikilinks } from "@/server/services/wikilinks";
import { expandRunbook, nestedTexts } from "@/server/services/kb-runbooks";
import { flattenNested, isGroup, type NestedStep } from "@/server/kb/runbook-nest";
import type { RunbookStep } from "@/server/kb/runbook";

/**
 * The knowledge base over REST: the same reads MCP offers and the same
 * writes a grant allows, as plain routes under /api/v1/kb. A key reads the
 * collections its companies or its grants give it; only the MCP door is one
 * a collection can close, so `mcp_enabled` plays no part here.
 */

/**
 * The key as a reader. `?audience=public` narrows it to what the public site
 * shows, so an integration can show a person exactly what they would see there.
 */
export function kbReaderFor(key: AuthenticatedKey, url?: URL): KbReader {
  return {
    scope: key.companies,
    via: "api",
    granted: key.kbGrants.filter((grant) => grant.canRead).map((grant) => grant.collectionId),
    ...(url?.searchParams.get("audience") === "public" ? { audience: "public" as const } : {}),
  };
}

/** The `source_type` filter, repeatable: `?source_type=pdf&source_type=docx`. */
export function sourceTypesFrom(url: URL): string[] | undefined {
  const values = url.searchParams.getAll("source_type").map((v) => v.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

export const READER_HEADER = "X-Trove-Reader";

/** Whether the key may keep a reader's reactions on this collection: on unless an admin turned it off. */
export function reactionsAllowed(key: AuthenticatedKey, collectionId: string): boolean {
  const grant = key.kbGrants.find((row) => row.collectionId === collectionId);
  return grant ? grant.reactions : true;
}

/** Collections an admin closed to reactions for this key. */
export function reactionsClosed(key: AuthenticatedKey): string[] {
  return key.kbGrants.filter((row) => !row.reactions).map((row) => row.collectionId);
}

/** The body of a vote: helpful, or not. */
export const voteBodySchema = z.object({ helpful: z.boolean() });

/**
 * The reader an integration acts for, as the key favorites and votes are
 * kept under on the public site: the same email gives the same key, and the
 * email itself is never stored. Null when the header is absent.
 */
export function readerKeyFrom(request: Request): string | null {
  const email = request.headers.get(READER_HEADER)?.trim() ?? "";
  if (email === "" || !email.includes("@") || email.length > 320) return null;
  return readerKey(email);
}

export function kbWriterFor(key: AuthenticatedKey): KbWriter {
  return { via: "api", scope: key.companies, grants: key.kbGrants, keyId: key.id, keyName: key.name };
}

/** The body a PUT carries, in the API's own words. */
export const kbUpsertBodySchema = z.object({
  title: z.string().trim().min(1).max(500),
  body: z.string().min(1),
  category: z.string().trim().min(1).max(200).optional(),
  subcategory: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(ARTICLE_KINDS).optional(),
  source_url: z.string().trim().max(2000).optional(),
  /** True keeps the article off the public site; false puts it back. Left out, it stays as it was. */
  internal_only: z.boolean().optional(),
});

export function serializeCollection(row: CollectionRow, writer: Pick<KbWriter, "grants" | "via">) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    site_url: row.siteUrl ?? null,
    public: row.publicAccess,
    writable: mayWrite(writer, row.id),
    favorites: row.favorites,
    helpfulness: row.helpful,
    articles: row.articleCount,
    created_at: row.createdAt.toISOString(),
  };
}

export function serializeArticleSummary(article: ArticleSummary, collection?: { id: string; name: string }) {
  return {
    id: article.id,
    external_id: article.externalId,
    title: article.title,
    kind: article.kind,
    source_type: article.sourceType,
    public: article.public,
    favorites: article.favorites,
    helpfulness: article.helpful,
    category: article.category,
    subcategory: article.subcategory,
    source_url: article.sourceUrl,
    date_modified: article.dateModified?.toISOString() ?? null,
    readable: article.extraction === "ok",
    ...(collection ? { collection } : {}),
  };
}

export function serializeFavorite(row: FavoriteRow) {
  return {
    ...serializeArticleSummary(row, { id: row.collectionId, name: row.collectionName }),
    favorited_at: row.favoritedAt.toISOString(),
  };
}

/** What one reader did with the article, when the request names one. */
export async function mineFor(readerKey: string | null, articleId: string) {
  if (!readerKey) return {};
  const reaction = await readerReaction(readerKey, articleId);
  return { mine: { favorite: reaction.favorite, vote: reaction.vote === null ? null : reaction.vote ? "up" : "down" } };
}

export async function serializeReactions(articleId: string, readerKey: string | null) {
  const counts = await reactionCounts(articleId);
  return {
    favorites: counts.favorites,
    helpful_up: counts.helpfulUp,
    helpful_down: counts.helpfulDown,
    helpfulness: counts.helpfulness,
    ...(await mineFor(readerKey, articleId)),
  };
}

/** A step's text and note with [[links]] as ordinary Markdown links the key can open, or their labels. */
function withLinks<T extends Pick<RunbookStep, "text" | "note">>(step: T, links: WikilinkIndex): T {
  return {
    ...step,
    text: wikilinksToMarkdown(step.text, links),
    ...(step.note !== undefined ? { note: wikilinksToMarkdown(step.note, links) } : {}),
  };
}

/**
 * A runbook as one list in reading order, each step that is only a link to
 * another runbook followed by that runbook's steps: `id` is the step's path
 * (`step/step`), unique across the list, for keying progress; `group` steps
 * are done when every step under them is.
 */
export function serializeExpandedSteps(nested: readonly NestedStep[], links: WikilinkIndex) {
  return flattenNested(nested).map((step) => ({
    id: step.path,
    step_id: step.id,
    runbook_id: step.articleId,
    parent_id: step.parent,
    depth: step.depth,
    group: isGroup(step),
    text: step.runbook ? step.text : wikilinksToMarkdown(step.text, links),
    ...(step.note !== undefined ? { note: wikilinksToMarkdown(step.note, links) } : {}),
    ...(step.canned ? { canned: step.canned } : {}),
    ...(step.runbook ? { includes: { id: step.runbook.id, title: step.runbook.title, status: step.runbook.status } } : {}),
  }));
}

export async function serializeArticle(article: ArticleDetail, readerKey: string | null = null, reader?: KbReader) {
  // Read as the key reads: linked runbooks it may read open into their steps,
  // and a [[link]] is a link where it may open the page, its label elsewhere.
  const nested = reader && article.kind === "runbook" ? await expandRunbook(article, reader) : [];
  const links = reader
    ? await resolveWikilinks([article.body, ...nestedTexts(nested)], {
        scope: reader.scope,
        kb: reader,
        publicSite: reader.audience === "public",
        base: env.APP_URL.replace(/\/+$/, ""),
      })
    : new Map();
  return {
    ...serializeArticleSummary(article, { id: article.collectionId, name: article.collectionName }),
    ...(await mineFor(readerKey, article.id)),
    // Echoed to the key that wrote it, the body is as written; read, its links are links.
    body: reader ? wikilinksToMarkdown(article.body, links) : article.body,
    format: article.format,
    ...(article.kind === "runbook"
      ? {
          steps: reader ? article.steps.map((step) => withLinks(step, links)) : article.steps,
          ...(reader ? { expanded_steps: serializeExpandedSteps(nested, links) } : {}),
        }
      : {}),
    internal_only: article.publicHidden,
    public_url: await publicAddressFor(article),
    attachments: {
      documents: article.metadata.doc_attachments ?? [],
      images: article.metadata.image_attachments ?? [],
    },
    date_created: article.dateCreated?.toISOString() ?? null,
    updated_at: article.updatedAt.toISOString(),
  };
}

export function serializeHit(hit: KbHit) {
  return {
    id: hit.articleId,
    title: hit.title,
    kind: hit.kind,
    source_type: hit.sourceType,
    public: hit.public,
    collection: { id: hit.collectionId, name: hit.collectionName },
    category: hit.category,
    subcategory: hit.subcategory,
    source_url: hit.sourceUrl,
    date_modified: hit.dateModified?.toISOString() ?? null,
    matched: { chunk: hit.chunk, heading: hit.heading, snippet: hit.snippet },
  };
}
