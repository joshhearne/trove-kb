import "server-only";
import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import { companies, documents, kbArticles, kbCollections, kbLinks } from "@/server/db/schema";
import { scopeWhere, type CompanyScope } from "@/server/auth/company-scope";
import { readable, type KbReader } from "@/server/services/kb";
import { wikilinkTargets, type WikilinkKind } from "@/lib/wikilinks";

/**
 * Backlinks where a knowledge base article is at one end (kb_links): written
 * from a page's text on every save, read for the page linked to, and only
 * ever showing a reader the pages they may open.
 */

type Executor = Tx | typeof db;

/**
 * Rewrites the links a page's text makes to or from an article. A document's
 * links to other documents are document_links' business, not this table's.
 */
export async function syncKbLinks(
  tx: Executor,
  from: { kind: WikilinkKind; id: string },
  texts: readonly string[],
): Promise<void> {
  await tx.delete(kbLinks).where(and(eq(kbLinks.fromKind, from.kind), eq(kbLinks.fromId, from.id)));
  const seen = new Set<string>();
  const rows: (typeof kbLinks.$inferInsert)[] = [];
  for (const target of texts.flatMap((text) => wikilinkTargets(text))) {
    if (from.kind === "doc" && target.kind === "doc") continue;
    if (target.kind === from.kind && target.id === from.id) continue;
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ fromKind: from.kind, fromId: from.id, toKind: target.kind, toId: target.id });
  }
  if (rows.length > 0) await tx.insert(kbLinks).values(rows).onConflictDoNothing();
}

export type PageBacklinks = {
  documents: { id: string; title: string; companyName: string }[];
  articles: { id: string; title: string; collectionName: string; kind: string }[];
};

/**
 * The pages linking to this one that the reader may open: documents of their
 * companies, articles of collections they may read, none archived. A link from
 * a page they may not open is not mentioned at all, so its title, and that it
 * exists, stay theirs who may.
 */
export async function listPageBacklinks(
  to: { kind: WikilinkKind; id: string },
  reader: { scope: CompanyScope; kb: KbReader; publicSite?: boolean },
): Promise<PageBacklinks> {
  const links = await db
    .select({ fromKind: kbLinks.fromKind, fromId: kbLinks.fromId })
    .from(kbLinks)
    .where(and(eq(kbLinks.toKind, to.kind), eq(kbLinks.toId, to.id)));
  const docIds = links.filter((link) => link.fromKind === "doc").map((link) => link.fromId);
  const kbIds = links.filter((link) => link.fromKind === "kb").map((link) => link.fromId);
  const result: PageBacklinks = { documents: [], articles: [] };

  if (docIds.length > 0 && !reader.publicSite) {
    const filters: SQL[] = [inArray(documents.id, docIds), isNull(documents.archivedAt) as SQL];
    const scoped = scopeWhere(reader.scope, documents.companyId);
    if (scoped) filters.push(scoped);
    result.documents = await db
      .select({ id: documents.id, title: documents.title, companyName: companies.name })
      .from(documents)
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(and(...filters))
      .orderBy(asc(documents.title));
  }

  if (kbIds.length > 0) {
    result.articles = await db
      .select({ id: kbArticles.id, title: kbArticles.title, collectionName: kbCollections.name, kind: kbArticles.kind })
      .from(kbArticles)
      .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
      .where(and(inArray(kbArticles.id, kbIds), isNull(kbArticles.archivedAt), ...readable(reader.kb)))
      .orderBy(asc(kbArticles.title));
  }
  return result;
}
