import "server-only";
import { env } from "@/lib/env";
import { serializeExpandedSteps } from "@/server/api/kb";
import { resolveWikilinks } from "@/server/services/wikilinks";
import { expandRunbook, nestedTexts } from "@/server/services/kb-runbooks";
import { z } from "zod";
import { serializeCompany, serializeDocument } from "@/server/api/serializers";
import { getCompany, listCompaniesPage } from "@/server/services/companies";
import { listLocations } from "@/server/services/locations";
import { listDocTypes, listTemplateFields } from "@/server/services/doc-types";
import { getDocumentDetail, listBacklinks, listCompanyDocuments } from "@/server/services/documents";
import { searchDocuments } from "@/server/services/search";
import {
  getArticle,
  listCategories,
  listArticles,
  listChunks,
  listCollections,
  searchKb,
  type KbReader,
} from "@/server/services/kb";
import {
  archiveArticle,
  articleWriteSchema,
  mayWrite,
  readerFor,
  writeArticle,
} from "@/server/services/kb-write";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import type { KbGrant } from "@/server/services/kb-grants";
import { ARTICLE_KINDS } from "@/server/kb/extract";
import { toolError, toolResult, type ToolResult } from "@/server/mcp/protocol";
import type { CompanyScope } from "@/server/auth/company-scope";

/**
 * Tools over the documentation and the knowledge base. The documentation is
 * read-only here, and nothing can return a secret: a secret_ref is redacted
 * the same way it is for webhooks, and there is deliberately no reveal tool.
 * Revealing a credential is a decision for a person at a keyboard, with an
 * audit entry.
 *
 * The knowledge base can be written to, by a key an administrator granted
 * that on a collection, and only there. A key with no such grant is never
 * shown the tools that write.
 */

/** Who is calling: the key, what it may see, and what it was granted. */
export type McpCaller = {
  scope: CompanyScope;
  via: "mcp";
  keyId: string;
  keyName: string;
  grants: readonly KbGrant[];
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
    * The scope is the API key's: a key limited to named companies gives its
    * model a view limited to the same ones, search included.
    */
  run: (
    args: Record<string, unknown>,
    scope: CompanyScope,
    caller: McpCaller,
  ) => Promise<ToolResult>;
  /** Changes something. Offered only to a key that was granted a collection to write. */
  writes?: boolean;
};

const searchArgs = z.object({
  query: z.string().trim().min(1, "query is required").max(200),
  company_id: z.uuid().optional(),
  doc_type_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const companyArgs = z.object({ company_id: z.uuid() });
const documentArgs = z.object({ document_id: z.uuid() });
const listCompaniesArgs = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const kbSearchArgs = z.object({
  query: z.string().trim().min(1, "query is required").max(200),
  collection_id: z.uuid().optional(),
  category: z.string().trim().max(200).optional(),
  kind: z.enum(ARTICLE_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const kbCollectionArgs = z.object({ collection_id: z.uuid() });

const kbListArgs = z.object({
  collection_id: z.uuid(),
  category: z.string().trim().max(200).optional(),
  subcategory: z.string().trim().max(200).optional(),
  kind: z.enum(ARTICLE_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().max(20).optional(),
});

const kbWriteArgs = z.object({
  collection_id: z.uuid(),
  external_id: z.string(),
  title: z.string(),
  body: z.string(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  source_url: z.string().optional(),
  internal_only: z.boolean().optional(),
  kind: z.enum(ARTICLE_KINDS).optional(),
});

const kbArchiveArgs = z.object({ article_id: z.uuid() });

const kbArticleArgs = z.object({
  article_id: z.uuid(),
  start_chunk: z.coerce.number().int().min(0).default(0),
  max_chunks: z.coerce.number().int().min(1).max(40).default(12),
});

/**
 * The key's companies and its grants decide which collections it may read,
 * and a collection can be closed to MCP altogether.
 */
function kbReader(caller: McpCaller): KbReader {
  return readerFor(caller);
}

/** A refusal from the service, in words the model can act on. */
function refused(error: unknown): ToolResult | null {
  if (error instanceof z.ZodError) return invalid(error);
  if (error instanceof NotFoundError) return toolError(`No ${error.message.replace(" not found", "").toLowerCase()} with that id`);
  if (error instanceof ForbiddenError) return toolError(error.message);
  return null;
}

/** A search headline as plain text: the marks mean nothing to a model. */
function plainSnippet(snippet: string): string {
  return snippet.replace(/<\/?mark>/g, "");
}

/** Turns a Zod failure into something a model can act on. */
function invalid(error: z.ZodError): ToolResult {
  const detail = error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return toolError(`Invalid arguments — ${detail}`);
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "search_documents",
    title: "Search documents",
    description:
      "Full-text search across every document. Returns matching documents with their " +
      "company, location, and doc type. Use this first when you do not know where " +
      "something is documented.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words or a quoted phrase. OR is supported." },
        company_id: { type: "string", format: "uuid", description: "Restrict to one company." },
        doc_type_id: { type: "string", format: "uuid", description: "Restrict to one doc type." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["query"],
    },
    async run(args, scope) {
      const parsed = searchArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const results = await searchDocuments({
        q: parsed.data.query,
        ...(parsed.data.company_id ? { companyId: parsed.data.company_id } : {}),
        ...(parsed.data.doc_type_id ? { docTypeId: parsed.data.doc_type_id } : {}),
        limit: parsed.data.limit,
      }, scope);

      return toolResult({
        query: parsed.data.query,
        count: results.hits.length,
        documents: results.hits.map((hit) => ({
          document_id: hit.id,
          title: hit.title,
          company: { id: hit.companyId, name: hit.companyName },
          doc_type: hit.docTypeName,
          location: hit.locationName,
          updated_at: hit.updatedAt.toISOString(),
        })),
      });
    },
  },

  {
    name: "get_document",
    title: "Read a document",
    description:
      "Every field of one document, with values resolved to labels and linked titles. " +
      "Secret fields report only that a credential exists and where it lives; the " +
      "credential itself is never returned.",
    inputSchema: {
      type: "object",
      properties: { document_id: { type: "string", format: "uuid" } },
      required: ["document_id"],
    },
    async run(args, scope) {
      const parsed = documentArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const detail = await getDocumentDetail(parsed.data.document_id, scope);
      if (!detail) return toolError("No document with that id");

      const [company, backlinks] = await Promise.all([
        getCompany(detail.document.companyId, scope),
        listBacklinks(parsed.data.document_id, scope),
      ]);

      // redactSecrets keeps every secret_ref out of the payload entirely.
      const serialized = serializeDocument({ ...detail, redactSecrets: true });

      return toolResult({
        ...serialized,
        company_name: company?.name ?? null,
        linked_from: backlinks.map((link) => ({
          document_id: link.documentId,
          title: link.title,
          doc_type: link.docTypeName,
          field: link.fieldLabel,
        })),
        note: "Secret fields are omitted. Reveal a credential in Trove KB, where it is audited.",
      });
    },
  },

  {
    name: "list_companies",
    title: "List companies",
    description: "Every company, optionally filtered by name.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Match part of a company name." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    },
    async run(args, scope) {
      const parsed = listCompaniesArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const rows = await listCompaniesPage({
        ...(parsed.data.query ? { q: parsed.data.query } : {}),
        limit: parsed.data.limit,
        cursor: null,
        scope,
      });

      return toolResult({
        count: rows.length,
        companies: rows.slice(0, parsed.data.limit).map((row) => serializeCompany(row)),
      });
    },
  },

  {
    name: "get_company",
    title: "Read a company",
    description:
      "One company with its locations and a summary of every document it holds. Use " +
      "this to see what is documented for a client before reading any one document.",
    inputSchema: {
      type: "object",
      properties: { company_id: { type: "string", format: "uuid" } },
      required: ["company_id"],
    },
    async run(args, scope) {
      const parsed = companyArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const company = await getCompany(parsed.data.company_id, scope);
      if (!company) return toolError("No company with that id");

      const [locations, documents] = await Promise.all([
        listLocations(company.id, scope),
        listCompanyDocuments(company.id, scope),
      ]);

      return toolResult({
        company: serializeCompany(company),
        locations: locations.map((location) => ({
          id: location.id,
          name: location.name,
          address: location.address,
        })),
        documents: documents.map((document) => ({
          document_id: document.id,
          title: document.title,
          doc_type: document.docTypeName,
          location: document.locationName,
          updated_at: document.updatedAt.toISOString(),
        })),
      });
    },
  },

  {
    name: "list_doc_types",
    title: "List doc types",
    description:
      "The templates documents are built from, with their fields. Useful for knowing " +
      "what information Trove KB expects to hold about a firewall, a circuit, and so on.",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const docTypes = await listDocTypes();

      const described = await Promise.all(
        docTypes.map(async (docType) => ({
          id: docType.id,
          name: docType.name,
          scope: docType.scope,
          document_count: docType.documentCount,
          fields: (await listTemplateFields(docType.id)).map((field) => ({
            label: field.label,
            type: field.fieldType,
            required: field.required,
          })),
        })),
      );

      return toolResult({ count: described.length, doc_types: described });
    },
  },

  {
    name: "list_kb_collections",
    title: "List knowledge base collections",
    description:
      "The knowledge base collections available to search: reference material brought " +
      "in from outside, such as a vendor's published KB, held apart from the client " +
      "documentation. Pass a collection_id to see its categories.",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: {
          type: "string",
          format: "uuid",
          description: "List this collection's categories and subcategories.",
        },
      },
    },
    async run(args, _scope, caller) {
      if (args.collection_id !== undefined) {
        const parsed = kbCollectionArgs.safeParse(args);
        if (!parsed.success) return invalid(parsed.error);

        const collections = await listCollections(kbReader(caller));
        const collection = collections.find((row) => row.id === parsed.data.collection_id);
        if (!collection) return toolError("No collection with that id");

        const categories = await listCategories(collection.id, kbReader(caller));
        return toolResult({
          collection: { id: collection.id, name: collection.name, articles: collection.articleCount },
          categories: categories.map((row) => ({
            category: row.category,
            subcategory: row.subcategory,
            articles: row.articles,
          })),
        });
      }

      const collections = await listCollections(kbReader(caller));
      return toolResult({
        count: collections.length,
        collections: collections.map((row) => ({
          collection_id: row.id,
          name: row.name,
          description: row.description,
          site_url: row.siteUrl,
          writable: mayWrite(caller, row.id),
          articles: row.articleCount,
          last_modified: row.lastModified ? new Date(row.lastModified).toISOString() : null,
        })),
      });
    },
  },

  {
    name: "search_kb",
    title: "Search the knowledge base",
    description:
      "Full-text search across knowledge base articles, including the text of their " +
      "attached documents. Returns one result per article with the passage that matched " +
      "and the article's source_url. Cite the source_url when you answer from a result.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words or a quoted phrase. OR is supported." },
        collection_id: { type: "string", format: "uuid", description: "Restrict to one collection." },
        category: { type: "string", description: "Restrict to one category, by exact name." },
        kind: {
          type: "string",
          enum: ["article", "runbook"],
          description: "Only articles, or only runbooks: procedures whose steps are kept apart.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["query"],
    },
    async run(args, _scope, caller) {
      const parsed = kbSearchArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const results = await searchKb(
        {
          q: parsed.data.query,
          ...(parsed.data.collection_id ? { collectionId: parsed.data.collection_id } : {}),
          ...(parsed.data.category ? { category: parsed.data.category } : {}),
          ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
          limit: parsed.data.limit,
        },
        kbReader(caller),
      );

      return toolResult({
        query: parsed.data.query,
        count: results.hits.length,
        articles: results.hits.map((hit) => ({
          article_id: hit.articleId,
          title: hit.title,
          kind: hit.kind,
          collection: { id: hit.collectionId, name: hit.collectionName },
          category: hit.category,
          subcategory: hit.subcategory,
          source_url: hit.sourceUrl,
          date_modified: hit.dateModified?.toISOString() ?? null,
          matched: {
            chunk: hit.chunk,
            heading: hit.heading,
            snippet: plainSnippet(hit.snippet),
          },
        })),
      });
    },
  },

  {
    name: "get_kb_article",
    title: "Read a knowledge base article",
    description:
      "One knowledge base article with its metadata and source_url. A long article " +
      "comes a part at a time: when next_chunk is not null, call again with " +
      "start_chunk set to it. To read around a search result, pass its matched chunk " +
      "as start_chunk. A runbook carries steps, and expanded_steps: each step that is only " +
      "a link to another runbook followed by that runbook's steps, keyed by path.",
    inputSchema: {
      type: "object",
      properties: {
        article_id: { type: "string", format: "uuid" },
        start_chunk: { type: "integer", minimum: 0, default: 0 },
        max_chunks: { type: "integer", minimum: 1, maximum: 40, default: 12 },
      },
      required: ["article_id"],
    },
    async run(args, _scope, caller) {
      const parsed = kbArticleArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const reader = kbReader(caller);
      const article = await getArticle(parsed.data.article_id, reader);
      if (!article) return toolError("No article with that id");

      const part = await listChunks(
        article.id,
        parsed.data.start_chunk,
        parsed.data.max_chunks,
        reader,
      );
      const chunks = part?.chunks ?? [];
      const total = part?.total ?? 0;
      const last = chunks[chunks.length - 1]?.ordinal ?? parsed.data.start_chunk;

      // A runbook's links to other runbooks, opened into their steps as this caller may read them.
      const nested = article.kind === "runbook" ? await expandRunbook(article, reader) : [];
      const links =
        article.kind === "runbook"
          ? await resolveWikilinks(nestedTexts(nested), { scope: reader.scope, kb: reader, base: env.APP_URL.replace(/\/+$/, "") })
          : new Map();

      return toolResult({
        article_id: article.id,
        title: article.title,
        kind: article.kind,
        ...(article.kind === "runbook"
          ? { steps: article.steps, expanded_steps: serializeExpandedSteps(nested, links) }
          : {}),
        collection: { id: article.collectionId, name: article.collectionName },
        category: article.category,
        subcategory: article.subcategory,
        source_url: article.sourceUrl,
        external_id: article.externalId,
        date_created: article.dateCreated?.toISOString() ?? null,
        date_modified: article.dateModified?.toISOString() ?? null,
        attachments: {
          documents: article.metadata.doc_attachments ?? [],
          images: article.metadata.image_attachments ?? [],
        },
        ...(article.extraction === "unextracted"
          ? { note: "This file has no text layer, so there is nothing to read. Open the source." }
          : {}),
        total_chunks: total,
        next_chunk: last + 1 < total ? last + 1 : null,
        chunks: chunks.map((chunk) => ({
          chunk: chunk.ordinal,
          heading: chunk.heading,
          text: chunk.content,
        })),
      });
    },
  },

  {
    name: "list_kb_articles",
    title: "List knowledge base articles",
    description:
      "The articles in one collection, with each one's external_id and when it last " +
      "changed. Use this before writing, to see what already exists and which " +
      "external_id to reuse.",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", format: "uuid" },
        category: { type: "string", description: "Restrict to one category, by exact name." },
        subcategory: { type: "string" },
        kind: {
          type: "string",
          enum: ["article", "runbook"],
          description: "Only articles, or only runbooks: procedures whose steps are kept apart.",
        },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
        cursor: { type: "string", description: "next_cursor from the previous page." },
      },
      required: ["collection_id"],
    },
    async run(args, _scope, caller) {
      const parsed = kbListArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const reader = kbReader(caller);
      const collections = await listCollections(reader);
      const collection = collections.find((row) => row.id === parsed.data.collection_id);
      if (!collection) return toolError("No collection with that id");

      const page = await listArticles(
        {
          collectionId: collection.id,
          ...(parsed.data.category ? { category: parsed.data.category } : {}),
          ...(parsed.data.subcategory ? { subcategory: parsed.data.subcategory } : {}),
          ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
          limit: parsed.data.limit,
          ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        },
        reader,
      );

      return toolResult({
        collection: {
          id: collection.id,
          name: collection.name,
          writable: mayWrite(caller, collection.id),
          articles: collection.articleCount,
        },
        count: page.articles.length,
        next_cursor: page.nextCursor,
        articles: page.articles.map((article) => ({
          article_id: article.id,
          external_id: article.externalId,
          title: article.title,
          kind: article.kind,
          category: article.category,
          subcategory: article.subcategory,
          source_url: article.sourceUrl,
          date_modified: article.dateModified?.toISOString() ?? null,
        })),
      });
    },
  },

  {
    name: "upsert_kb_article",
    title: "Write a knowledge base article",
    writes: true,
    description:
      "Creates an article, or replaces the one with the same external_id in that " +
      "collection. Only collections marked writable accept this. The body is Markdown. " +
      "Choose an external_id that will stay the same for the life of the article — a " +
      "path-like slug such as billing/refunds — and send the whole article each time, " +
      "not a change to it. Writing identical content again changes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        collection_id: { type: "string", format: "uuid" },
        external_id: {
          type: "string",
          maxLength: 200,
          description: "Stable name for the article. Reuse it to update.",
        },
        title: { type: "string", maxLength: 500 },
        body: { type: "string", description: "The whole article, in Markdown." },
        category: { type: "string", maxLength: 200 },
        subcategory: { type: "string", maxLength: 200 },
        source_url: {
          type: "string",
          description: "Where a reader can see what the article describes, if anywhere.",
        },
        internal_only: {
          type: "boolean",
          description:
            "True keeps this article off the public site, where people read without " +
            "signing in. Set it for anything about administration, security, or how " +
            "systems are built. Leave it out to keep the article's current setting.",
        },
        kind: {
          type: "string",
          enum: ["article", "runbook"],
          description:
            "A runbook is a procedure: the items of the body's first numbered list are its " +
            "steps, each given a stable id on save (or written as `{#id}` at the end of the " +
            "item) that a system tracking progress keys on. A step that is only a link to " +
            "another runbook, [[kb:<id>|Name]], opens into that runbook's steps. Default article.",
        },
      },
      required: ["collection_id", "external_id", "title", "body"],
    },
    async run(args, _scope, caller) {
      const parsed = kbWriteArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      const input = articleWriteSchema.safeParse({
        collectionId: parsed.data.collection_id,
        externalId: parsed.data.external_id,
        title: parsed.data.title,
        body: parsed.data.body,
        ...(parsed.data.category ? { category: parsed.data.category } : {}),
        ...(parsed.data.subcategory ? { subcategory: parsed.data.subcategory } : {}),
        ...(parsed.data.source_url ? { sourceUrl: parsed.data.source_url } : {}),
        ...(parsed.data.internal_only !== undefined
          ? { publicHidden: parsed.data.internal_only }
          : {}),
        ...(parsed.data.kind ? { kind: parsed.data.kind } : {}),
      });
      if (!input.success) return invalid(input.error);

      try {
        const result = await writeArticle(input.data, caller);
        return toolResult({
          article_id: result.articleId,
          external_id: input.data.externalId,
          outcome: result.outcome,
        });
      } catch (error) {
        const answer = refused(error);
        if (answer) return answer;
        throw error;
      }
    },
  },

  {
    name: "archive_kb_article",
    title: "Archive a knowledge base article",
    writes: true,
    description:
      "Takes an article out of the collection and out of search, for one that no " +
      "longer applies. Nothing is deleted: writing the same external_id again brings " +
      "it back.",
    inputSchema: {
      type: "object",
      properties: { article_id: { type: "string", format: "uuid" } },
      required: ["article_id"],
    },
    async run(args, _scope, caller) {
      const parsed = kbArchiveArgs.safeParse(args);
      if (!parsed.success) return invalid(parsed.error);

      try {
        await archiveArticle(parsed.data.article_id, caller);
        return toolResult({ article_id: parsed.data.article_id, outcome: "archived" });
      } catch (error) {
        const answer = refused(error);
        if (answer) return answer;
        throw error;
      }
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Whether this key is offered this tool at all. */
export function canUse(tool: ToolDefinition, caller: McpCaller): boolean {
  return !tool.writes || caller.grants.some((grant) => grant.canWrite);
}

/** The wire shape of tools/list. */
export function describeTools(caller: McpCaller) {
  return TOOLS.filter((tool) => canUse(tool, caller)).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.writes
      ? // Nothing is deleted, and the same call twice leaves things as once.
        { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
      : { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }));
}
