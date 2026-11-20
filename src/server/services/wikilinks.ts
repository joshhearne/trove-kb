import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import {
  companies,
  docTypes,
  documents,
  fields,
  kbArticles,
  kbCollectionCompanies,
  kbCollections,
} from "@/server/db/schema";
import { isInScope, scopeWhere, type CompanyScope } from "@/server/auth/company-scope";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { createDocument } from "@/server/services/documents";
import { getArticle, readable, type KbReader } from "@/server/services/kb";
import { writeArticle, type KbWriter } from "@/server/services/kb-write";
import { keyOf, wikilinkTargets, type WikilinkIndex, type WikilinkKind } from "@/lib/wikilinks";

/**
 * Links between pages (src/lib/wikilinks.ts) as the database knows them:
 * which pages a reader may open, which pages an author may link to with what
 * caveats, and a page made on the spot for a link to a page not yet written.
 *
 * A document belongs to one company; a knowledge base collection is open to
 * every company or kept to some, and may be on the public site. A link from
 * one to the other can therefore reach readers who cannot follow it, and the
 * author is told so (`WikilinkFlag`) — the link is still theirs to make.
 */

/** Where a link is being written, which decides who will read it. */
export const wikilinkContextSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    companyId: z.uuid(),
    documentId: z.uuid().nullish(),
    locationId: z.uuid().nullish(),
  }),
  z.object({
    kind: z.literal("article"),
    collectionId: z.uuid(),
    articleId: z.uuid().nullish(),
    publicSite: z.boolean(),
  }),
]);

export type WikilinkContext = z.infer<typeof wikilinkContextSchema>;

/**
 * Why some readers of the page being written may not be able to follow a link:
 * - otherCompany: a document of another company, from a document.
 * - internalDocument: a document, from a knowledge base article, whose
 *   readers include people outside the company and the public site.
 * - narrowerCollection: an article kept to fewer companies than the page
 *   linking to it is read by.
 * - notPublic: an article off the public site, from one on it.
 */
export type WikilinkFlag = "otherCompany" | "internalDocument" | "narrowerCollection" | "notPublic";

export type WikilinkSuggestion = {
  kind: WikilinkKind;
  id: string;
  title: string;
  /** The company of a document, the collection of an article. */
  where: string;
  flags: WikilinkFlag[];
  /** An article that is a runbook: a step that is only a link to it opens into its steps. */
  runbook?: boolean;
};

/* ---------- Resolving what a reader may open ---------- */

export type WikilinkReader = {
  scope: CompanyScope;
  kb: KbReader;
  /** A visitor to the public site: no document is ever theirs to open. */
  publicSite?: boolean;
  /** Put before every address, for a file read away from the site. */
  base?: string;
};

/**
 * The pages these texts link to, as this reader may open them: an address
 * where they may, none where they may not or the page is gone. Out of scope
 * is not found, so such a page's title is not given either.
 */
export async function resolveWikilinks(texts: readonly string[], reader: WikilinkReader): Promise<WikilinkIndex> {
  const index: WikilinkIndex = new Map();
  const targets = texts.flatMap((text) => wikilinkTargets(text));
  if (targets.length === 0) return index;
  const base = reader.base ?? "";

  const docIds = [...new Set(targets.filter((target) => target.kind === "doc").map((target) => target.id))];
  const kbIds = [...new Set(targets.filter((target) => target.kind === "kb").map((target) => target.id))];
  for (const id of docIds) index.set(keyOf("doc", id), { href: null, title: "" });
  for (const id of kbIds) index.set(keyOf("kb", id), { href: null, title: "" });

  if (docIds.length > 0 && !reader.publicSite) {
    const filters: SQL[] = [inArray(documents.id, docIds), isNull(documents.archivedAt) as SQL];
    const scoped = scopeWhere(reader.scope, documents.companyId);
    if (scoped) filters.push(scoped);
    const rows = await db.select({ id: documents.id, title: documents.title }).from(documents).where(and(...filters));
    for (const row of rows) index.set(keyOf("doc", row.id), { href: `${base}/documents/${row.id}`, title: row.title });
  }

  for (const id of kbIds) {
    const article = await getArticle(id, reader.kb);
    if (!article) continue;
    const path = reader.publicSite ? `/pub/kb/articles/${id}` : `/kb/articles/${id}`;
    index.set(keyOf("kb", id), { href: `${base}${path}`, title: article.title });
  }
  return index;
}

/* ---------- Who reads a collection ---------- */

type Audience = { allCompanies: boolean; companyIds: string[]; publicAccess: boolean };

async function audiences(collectionIds: string[]): Promise<Map<string, Audience>> {
  const ids = [...new Set(collectionIds)];
  const result = new Map<string, Audience>();
  if (ids.length === 0) return result;
  const rows = await db
    .select({ id: kbCollections.id, allCompanies: kbCollections.allCompanies, publicAccess: kbCollections.publicAccess })
    .from(kbCollections)
    .where(inArray(kbCollections.id, ids));
  const kept = await db
    .select({ collectionId: kbCollectionCompanies.collectionId, companyId: kbCollectionCompanies.companyId })
    .from(kbCollectionCompanies)
    .where(inArray(kbCollectionCompanies.collectionId, ids));
  for (const row of rows) {
    result.set(row.id, {
      allCompanies: row.allCompanies,
      publicAccess: row.publicAccess,
      companyIds: kept.filter((entry) => entry.collectionId === row.id).map((entry) => entry.companyId),
    });
  }
  return result;
}

/** Whether every company that reads `wide` also reads `narrow`. */
function covers(narrow: Audience, wide: Audience): boolean {
  if (narrow.allCompanies) return true;
  if (wide.allCompanies) return false;
  return wide.companyIds.every((id) => narrow.companyIds.includes(id));
}

/** The caveats of linking to a page from where the author is writing. */
export function flagsFor(
  context: WikilinkContext,
  target:
    | { kind: "doc"; companyId: string }
    | { kind: "kb"; collectionId: string; publicHidden: boolean; audience: Audience },
  source: Audience | null,
): WikilinkFlag[] {
  const flags: WikilinkFlag[] = [];
  if (context.kind === "document") {
    if (target.kind === "doc") {
      if (target.companyId !== context.companyId) flags.push("otherCompany");
    } else {
      const onPublicSite = target.audience.publicAccess && !target.publicHidden;
      const reachesCompany = target.audience.allCompanies || target.audience.companyIds.includes(context.companyId);
      if (!reachesCompany && !onPublicSite) flags.push("narrowerCollection");
    }
    return flags;
  }
  if (target.kind === "doc") return ["internalDocument"];
  if (source && target.collectionId !== context.collectionId && !covers(target.audience, source)) {
    flags.push("narrowerCollection");
  }
  if (context.publicSite && !(target.audience.publicAccess && !target.publicHidden)) flags.push("notPublic");
  return flags;
}

/* ---------- Suggesting pages as a link is typed ---------- */

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Pages whose title holds what has been typed, that the author may open:
 * documents first from the company being written in, then knowledge base
 * articles, each with its caveats.
 */
export async function suggestWikilinks(
  query: string,
  context: WikilinkContext,
  reader: { scope: CompanyScope; kb: KbReader },
): Promise<WikilinkSuggestion[]> {
  const typed = query.trim().slice(0, 200);
  const pattern = likePattern(typed);
  const startsWith = `${typed.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

  const docFilters: SQL[] = [isNull(documents.archivedAt) as SQL, isNull(companies.archivedAt) as SQL];
  if (typed) docFilters.push(sql`${documents.title} ILIKE ${pattern}`);
  const scoped = scopeWhere(reader.scope, documents.companyId);
  if (scoped) docFilters.push(scoped);
  if (context.kind === "document" && context.documentId) docFilters.push(ne(documents.id, context.documentId));
  const sameCompany = context.kind === "document" ? context.companyId : null;

  const docRows = await db
    .select({ id: documents.id, title: documents.title, companyId: documents.companyId, companyName: companies.name })
    .from(documents)
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .where(and(...docFilters))
    .orderBy(
      sql`CASE WHEN ${documents.companyId} = ${sameCompany} THEN 0 ELSE 1 END`,
      sql`CASE WHEN ${documents.title} ILIKE ${startsWith} THEN 0 ELSE 1 END`,
      asc(documents.title),
    )
    .limit(8);

  const kbFilters: SQL[] = [...readable(reader.kb), isNull(kbArticles.archivedAt) as SQL];
  if (typed) kbFilters.push(sql`${kbArticles.title} ILIKE ${pattern}`);
  if (context.kind === "article" && context.articleId) kbFilters.push(ne(kbArticles.id, context.articleId));
  const kbRows = await db
    .select({
      id: kbArticles.id,
      title: kbArticles.title,
      collectionId: kbArticles.collectionId,
      collectionName: kbCollections.name,
      publicHidden: kbArticles.publicHidden,
      kind: kbArticles.kind,
    })
    .from(kbArticles)
    .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
    .where(and(...kbFilters))
    .orderBy(
      sql`CASE WHEN ${kbArticles.collectionId} = ${context.kind === "article" ? context.collectionId : null} THEN 0 ELSE 1 END`,
      sql`CASE WHEN ${kbArticles.title} ILIKE ${startsWith} THEN 0 ELSE 1 END`,
      asc(kbArticles.title),
    )
    .limit(6);

  const known = await audiences([
    ...kbRows.map((row) => row.collectionId),
    ...(context.kind === "article" ? [context.collectionId] : []),
  ]);
  const source = context.kind === "article" ? (known.get(context.collectionId) ?? null) : null;
  const none: Audience = { allCompanies: false, companyIds: [], publicAccess: false };

  return [
    ...docRows.map((row) => ({
      kind: "doc" as const,
      id: row.id,
      title: row.title,
      where: row.companyName,
      flags: flagsFor(context, { kind: "doc", companyId: row.companyId }, source),
    })),
    ...kbRows.map((row) => ({
      kind: "kb" as const,
      id: row.id,
      title: row.title,
      where: row.collectionName,
      runbook: row.kind === "runbook",
      flags: flagsFor(
        context,
        { kind: "kb", collectionId: row.collectionId, publicHidden: row.publicHidden, audience: known.get(row.collectionId) ?? none },
        source,
      ),
    })),
  ];
}

/**
 * The caveats of the links already in a text, for the editor's preview: each
 * page linked to that some readers of this one may not be able to open.
 */
export async function flaggedWikilinks(
  text: string,
  context: WikilinkContext,
  reader: { scope: CompanyScope; kb: KbReader },
): Promise<{ title: string; flags: WikilinkFlag[] }[]> {
  const targets = wikilinkTargets(text);
  if (targets.length === 0) return [];
  const docIds = targets.filter((target) => target.kind === "doc").map((target) => target.id);
  const kbIds = targets.filter((target) => target.kind === "kb").map((target) => target.id);
  const found: { title: string; flags: WikilinkFlag[] }[] = [];

  if (docIds.length > 0) {
    const filters: SQL[] = [inArray(documents.id, docIds)];
    const scoped = scopeWhere(reader.scope, documents.companyId);
    if (scoped) filters.push(scoped);
    const rows = await db.select({ title: documents.title, companyId: documents.companyId }).from(documents).where(and(...filters));
    for (const row of rows) found.push({ title: row.title, flags: flagsFor(context, { kind: "doc", companyId: row.companyId }, null) });
  }
  if (kbIds.length > 0) {
    const rows = await db
      .select({ id: kbArticles.id, title: kbArticles.title, collectionId: kbArticles.collectionId, publicHidden: kbArticles.publicHidden })
      .from(kbArticles)
      .innerJoin(kbCollections, eq(kbCollections.id, kbArticles.collectionId))
      .where(and(inArray(kbArticles.id, kbIds), ...readable(reader.kb)));
    const known = await audiences([...rows.map((row) => row.collectionId), ...(context.kind === "article" ? [context.collectionId] : [])]);
    const source = context.kind === "article" ? (known.get(context.collectionId) ?? null) : null;
    for (const row of rows) {
      const audience = known.get(row.collectionId);
      if (!audience) continue;
      found.push({
        title: row.title,
        flags: flagsFor(context, { kind: "kb", collectionId: row.collectionId, publicHidden: row.publicHidden, audience }, source),
      });
    }
  }
  return found.filter((entry) => entry.flags.length > 0);
}

/* ---------- A page for a link to one not yet written ---------- */

export class NoMarkdownDocTypeError extends Error {
  constructor() {
    super("There is no Markdown-only document type to start the page with. An administrator can add one under Admin → Doc types: one Markdown field and nothing else.");
    this.name = "NoMarkdownDocTypeError";
  }
}

/**
 * The doc type a new page starts as: one whose template is a single Markdown
 * field. The type of the document being written wins when it is one; then a
 * company-wide type, then one for the document's location.
 */
async function markdownDocType(context: Extract<WikilinkContext, { kind: "document" }>) {
  const rows = await db
    .select({
      id: docTypes.id,
      name: docTypes.name,
      scope: docTypes.scope,
      fieldId: sql<string>`min(${fields.id}::text)`,
      fieldType: sql<string>`min(${fields.fieldType})`,
      required: sql<boolean>`bool_or(${fields.required})`,
      count: sql<number>`count(${fields.id})::int`,
    })
    .from(docTypes)
    .innerJoin(fields, and(eq(fields.docTypeId, docTypes.id), isNull(fields.documentId), isNull(fields.archivedAt)))
    .where(isNull(docTypes.archivedAt))
    .groupBy(docTypes.id)
    .orderBy(asc(docTypes.name));
  const usable = rows.filter(
    (row) => row.count === 1 && row.fieldType === "markdown" && (row.scope === "company" || !!context.locationId),
  );
  let source: string | null = null;
  if (context.documentId) {
    const [own] = await db.select({ docTypeId: documents.docTypeId }).from(documents).where(eq(documents.id, context.documentId)).limit(1);
    source = own?.docTypeId ?? null;
  }
  return usable.find((row) => row.id === source) ?? usable.find((row) => row.scope === "company") ?? usable[0] ?? null;
}

function mintExternalId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return `${slug || "article"}-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Makes the page a link names: a Markdown document in the same company as
 * the document linking to it, or an article in the same collection as the
 * article linking to it. Saved as any page is, with its revision and audit
 * entry; it starts empty but for its title.
 */
export async function createWikilinkTarget(
  title: string,
  context: WikilinkContext,
  author: { userId: string; scope: CompanyScope; writer: () => Promise<KbWriter> },
): Promise<WikilinkSuggestion> {
  const name = title.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!name) throw new ForbiddenError("Give the new page a title");

  if (context.kind === "document") {
    if (!isInScope(author.scope, context.companyId)) throw new NotFoundError("Company");
    const docType = await markdownDocType(context);
    if (!docType) throw new NoMarkdownDocTypeError();
    const result = await createDocument(
      {
        companyId: context.companyId,
        docTypeId: docType.id,
        locationId: docType.scope === "company" ? null : (context.locationId ?? null),
        title: name,
        values: { [docType.fieldId]: docType.required ? `# ${name}\n` : "" },
      },
      author.userId,
      author.scope,
    );
    if (!result.ok) throw new ForbiddenError(Object.values(result.errors)[0] ?? "The page could not be made");
    const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, context.companyId)).limit(1);
    return { kind: "doc", id: result.id, title: name, where: company?.name ?? "", flags: [] };
  }

  const writer = await author.writer();
  const { articleId } = await writeArticle(
    {
      collectionId: context.collectionId,
      externalId: mintExternalId(name),
      title: name,
      body: `# ${name}\n`,
      publicHidden: !context.publicSite,
    },
    writer,
  );
  const [collection] = await db.select({ name: kbCollections.name }).from(kbCollections).where(eq(kbCollections.id, context.collectionId)).limit(1);
  return { kind: "kb", id: articleId, title: name, where: collection?.name ?? "", flags: [] };
}
