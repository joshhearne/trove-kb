import "server-only";
import { z } from "zod";
import { companyInputSchema } from "@/server/services/companies";
import { locationInputSchema } from "@/server/services/locations";
import { externalRefInputSchema } from "@/server/services/external-refs";
import { API_SCOPES } from "@/server/services/api-keys";
import { kbUpsertBodySchema, voteBodySchema } from "@/server/api/kb";
import { FIELD_TYPES } from "@/server/db/schema";

/**
 * OpenAPI 3.1, generated from the same Zod schemas the endpoints validate with
 * (CLAUDE.md), so the document cannot drift from the behavior.
 */

const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });

const documentCreateSchema = z.object({
  company_id: z.uuid(),
  doc_type_id: z.uuid(),
  location_id: z.uuid().nullish(),
  title: z.string().min(1).max(300),
  field_values: z.record(z.string(), z.unknown()).optional(),
});

const documentPatchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  /** Partial merge, keyed by field UUID. */
  field_values: z.record(z.string(), z.unknown()).optional(),
});

const optionItemSchema = z.object({ label: z.string().min(1).max(200) });

const companyBodySchema = z.object({
  name: z.string().min(1).max(200),
  is_internal: z.boolean().optional(),
  notes: z.string().nullish(),
});

const locationBodySchema = z.object({
  company_id: z.uuid(),
  name: z.string().min(1).max(200),
  address: z.string().nullish(),
});

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const PAGE_PARAMS = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
  { name: "cursor", in: "query", schema: { type: "string" } },
];

function ok(description: string, schemaName?: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: schemaName ? { $ref: `#/components/schemas/${schemaName}` } : {},
      },
    },
  };
}

const ERRORS = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
  "422": { $ref: "#/components/responses/InvalidRequest" },
  "429": { $ref: "#/components/responses/RateLimited" },
};

function body(schema: z.ZodType) {
  return {
    required: true,
    content: { "application/json": { schema: jsonSchema(schema) } },
  };
}

const AUDIENCE_PARAM = { name: "audience", in: "query", schema: { type: "string", enum: ["key", "public"] }, description: "public narrows the view to what the public site shows." };
const SOURCE_TYPE_PARAM = { name: "source_type", in: "query", schema: { type: "array", items: { type: "string" } }, style: "form", explode: true, description: "md, html, pdf, docx, txt; repeatable." };
const READER_PARAM = { name: "X-Trove-Reader", in: "header", required: true, schema: { type: "string", format: "email" }, description: "The reader the key acts for. Never stored; the same email is the same reader on the public site." };

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

export function buildOpenApiDocument(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Trove KB API",
      version: "1.0.0",
      description:
        "Self-hosted structured IT documentation. Authenticate with an API key in the X-Auth-Token header, or as a bearer token.",
      license: { name: "AGPL-3.0-or-later", identifier: "AGPL-3.0-or-later" },
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ authToken: [] }, { apiKey: [] }],
    tags: [
      { name: "Companies" },
      { name: "Locations" },
      { name: "Doc types" },
      { name: "Documents" },
      { name: "Option lists" },
      { name: "Search" },
      { name: "Knowledge base" },
      { name: "People" },
      { name: "Integrations" },
    ],
    paths: {
      "/companies": {
        get: {
          tags: ["Companies"],
          summary: "List companies",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "external_system", in: "query", schema: { type: "string" } },
            { name: "external_id", in: "query", schema: { type: "string" } },
            ...PAGE_PARAMS,
          ],
          responses: { "200": ok("A page of companies"), ...ERRORS },
        },
        post: {
          tags: ["Companies"],
          summary: "Create a company",
          requestBody: body(companyBodySchema),
          responses: { "201": ok("The created company"), ...ERRORS },
        },
      },
      "/companies/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Companies"],
          summary: "Fetch a company",
          responses: { "200": ok("The company"), ...ERRORS },
        },
        patch: {
          tags: ["Companies"],
          summary: "Update a company",
          requestBody: body(companyBodySchema.partial()),
          responses: { "200": ok("The updated company"), ...ERRORS },
        },
      },
      "/companies/{id}/locations": {
        parameters: [idParam, ...PAGE_PARAMS],
        get: {
          tags: ["Locations"],
          summary: "List a company's locations",
          responses: { "200": ok("A page of locations"), ...ERRORS },
        },
      },
      "/companies/{id}/documents": {
        parameters: [
          idParam,
          { name: "doc_type", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "location_id", in: "query", schema: { type: "string", format: "uuid" } },
          ...PAGE_PARAMS,
        ],
        get: {
          tags: ["Documents"],
          summary: "List a company's documents",
          responses: { "200": ok("A page of documents"), ...ERRORS },
        },
      },
      "/locations": {
        post: {
          tags: ["Locations"],
          summary: "Create a location",
          requestBody: body(locationBodySchema),
          responses: { "201": ok("The created location"), ...ERRORS },
        },
      },
      "/locations/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Locations"],
          summary: "Fetch a location",
          responses: { "200": ok("The location"), ...ERRORS },
        },
        patch: {
          tags: ["Locations"],
          summary: "Update a location",
          requestBody: body(locationBodySchema.omit({ company_id: true }).partial()),
          responses: { "200": ok("The updated location"), ...ERRORS },
        },
      },
      "/doc-types": {
        get: {
          tags: ["Doc types"],
          summary: "List doc types with their template fields",
          responses: { "200": ok("Every active doc type"), ...ERRORS },
        },
      },
      "/doc-types/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Doc types"],
          summary: "Fetch one doc type",
          responses: { "200": ok("The doc type"), ...ERRORS },
        },
      },
      "/documents": {
        post: {
          tags: ["Documents"],
          summary: "Create a document",
          requestBody: body(documentCreateSchema),
          responses: { "201": ok("The created document"), ...ERRORS },
        },
      },
      "/documents/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Documents"],
          summary: "Fetch a document with resolved values",
          responses: { "200": ok("The document"), ...ERRORS },
        },
        patch: {
          tags: ["Documents"],
          summary: "Update a document, merging field_values",
          requestBody: body(documentPatchSchema),
          responses: { "200": ok("The updated document"), ...ERRORS },
        },
      },
      "/documents/{id}/revisions": {
        parameters: [idParam],
        get: {
          tags: ["Documents"],
          summary: "List a document's revisions, newest first",
          responses: { "200": ok("Revisions"), ...ERRORS },
        },
      },
      "/option-lists/{id}/items": {
        parameters: [idParam],
        get: {
          tags: ["Option lists"],
          summary: "List the items on an option list",
          responses: { "200": ok("Items"), ...ERRORS },
        },
        post: {
          tags: ["Option lists"],
          summary: "Add an item to an option list",
          requestBody: body(optionItemSchema),
          responses: { "201": ok("The created item"), "409": ok("That label already exists"), ...ERRORS },
        },
      },
      "/search": {
        get: {
          tags: ["Search"],
          summary: "Search every document",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "company_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "doc_type", in: "query", schema: { type: "string", format: "uuid" } },
            ...PAGE_PARAMS,
          ],
          responses: { "200": ok("Matching documents"), ...ERRORS },
        },
      },
      "/kb/collections": {
        get: {
          tags: ["Knowledge base"],
          summary: "List the knowledge base collections this key may read",
          parameters: [{ name: "writable", in: "query", schema: { type: "boolean" } }, AUDIENCE_PARAM],
          responses: { "200": ok("Collections, each with whether this key may write to it"), ...ERRORS },
        },
      },
      "/kb/collections/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Knowledge base"],
          summary: "Fetch a collection with its categories, kinds, source types, and counts",
          parameters: [{ name: "kind", in: "query", schema: { type: "string", enum: ["article", "runbook"] } }, AUDIENCE_PARAM],
          responses: { "200": ok("The collection, its categories, and how its articles break down"), ...ERRORS },
        },
      },
      "/kb/collections/{id}/articles/{external_id}": {
        parameters: [
          idParam,
          { name: "external_id", in: "path", required: true, schema: { type: "string" } },
        ],
        put: {
          tags: ["Knowledge base"],
          summary: "Write an article under its external id, creating or replacing it",
          description:
            "Needs the write scope and a write grant on the collection. `kind: \"runbook\"` keeps the body's " +
            "first numbered list apart as steps with stable ids; a repeated step id is refused with 400.",
          requestBody: body(kbUpsertBodySchema),
          responses: {
            "200": ok("The article, replaced"),
            "201": ok("The article, created"),
            "400": { $ref: "#/components/responses/InvalidRequest" },
            ...ERRORS,
          },
        },
        delete: {
          tags: ["Knowledge base"],
          summary: "Archive the article under this external id",
          responses: { "204": { description: "Archived" }, ...ERRORS },
        },
      },
      "/kb/search": {
        get: {
          tags: ["Knowledge base"],
          summary: "Search the knowledge base",
          description: "One hit per article: the passage that matched best, with where it is.",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "collection_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "kind", in: "query", schema: { type: "string", enum: ["article", "runbook"] } },
            SOURCE_TYPE_PARAM,
            AUDIENCE_PARAM,
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
            { name: "cursor", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": ok("Matching articles"), ...ERRORS },
        },
      },
      "/kb/articles": {
        get: {
          tags: ["Knowledge base"],
          summary: "List a collection's articles",
          parameters: [
            { name: "collection_id", in: "query", required: true, schema: { type: "string", format: "uuid" } },
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "subcategory", in: "query", schema: { type: "string" } },
            { name: "kind", in: "query", schema: { type: "string", enum: ["article", "runbook"] } },
            { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" } },
            SOURCE_TYPE_PARAM,
            AUDIENCE_PARAM,
            { name: "sort", in: "query", schema: { type: "string", enum: ["name", "modified"] } },
            { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
            ...PAGE_PARAMS,
          ],
          responses: { "200": ok("A page of articles"), ...ERRORS },
        },
      },
      "/kb/articles/{id}": {
        parameters: [idParam],
        get: {
          tags: ["Knowledge base"],
          summary: "Fetch an article in full",
          description:
            "The Markdown body, `external_id`, `source_url`, `source_type`, `public`, `public_url` (the address " +
            "on the public site, or null), `favorites` and `helpfulness`. A runbook also carries `steps`. With " +
            "X-Trove-Reader, `mine` says what that reader made of it.",
          parameters: [AUDIENCE_PARAM, { ...READER_PARAM, required: false }],
          responses: { "200": ok("The article"), ...ERRORS },
        },
      },
      "/kb/articles/{id}/reactions": {
        parameters: [idParam, READER_PARAM, AUDIENCE_PARAM],
        get: {
          tags: ["Knowledge base"],
          summary: "Everyone's favorites and votes on the article, and the named reader's own",
          responses: { "200": ok("{ favorites, helpful_up, helpful_down, helpfulness, mine: { favorite, vote } }"), "400": { $ref: "#/components/responses/InvalidRequest" }, ...ERRORS },
        },
      },
      "/kb/articles/{id}/favorite": {
        parameters: [idParam, READER_PARAM, AUDIENCE_PARAM],
        put: { tags: ["Knowledge base"], summary: "Keep the article for the named reader", responses: { "204": { description: "Kept" }, ...ERRORS } },
        delete: { tags: ["Knowledge base"], summary: "Let it go", responses: { "204": { description: "Let go" }, ...ERRORS } },
      },
      "/kb/articles/{id}/vote": {
        parameters: [idParam, READER_PARAM, AUDIENCE_PARAM],
        put: {
          tags: ["Knowledge base"],
          summary: "The named reader's vote",
          requestBody: body(voteBodySchema),
          responses: { "204": { description: "Recorded" }, ...ERRORS },
        },
        delete: { tags: ["Knowledge base"], summary: "Take the vote back", responses: { "204": { description: "Taken back" }, ...ERRORS } },
      },
      "/kb/favorites": {
        parameters: [READER_PARAM, AUDIENCE_PARAM],
        get: {
          tags: ["Knowledge base"],
          summary: "The named reader's favorites, newest first",
          parameters: PAGE_PARAMS,
          responses: { "200": ok("Articles with favorited_at"), ...ERRORS },
        },
      },
      "/users": {
        get: {
          tags: ["People"],
          summary: "List accounts",
          responses: { "200": ok("Every account"), ...ERRORS },
        },
        post: {
          tags: ["People"],
          summary: "Create an account by email, or return the one that exists",
          description:
            "No password is set: the person signs in through single sign-on, or an administrator sets a " +
            "temporary password. Answers 201 when created and 200 when the email was already an account.",
          requestBody: body(
            z.object({
              email: z.email(),
              name: z.string().min(1).max(200),
              role: z.string().optional(),
              all_companies: z.boolean().optional(),
            }),
          ),
          responses: { "200": ok("The existing account"), "201": ok("The created account"), ...ERRORS },
        },
      },
      "/kb/collections/{id}/grants/users/{userId}": {
        parameters: [idParam, { name: "userId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        put: {
          tags: ["Knowledge base"],
          summary: "Grant the collection to a person",
          requestBody: body(z.object({ can_write: z.boolean().optional() })),
          responses: { "200": ok("The grant"), ...ERRORS },
        },
        delete: {
          tags: ["Knowledge base"],
          summary: "Withdraw a person's grant",
          responses: { "204": { description: "Withdrawn" }, ...ERRORS },
        },
      },
      "/kb/collections/{id}/grants/api-keys/{keyId}": {
        parameters: [idParam, { name: "keyId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        put: {
          tags: ["Knowledge base"],
          summary: "Grant the collection to an API key",
          requestBody: body(z.object({ can_write: z.boolean().optional(), reactions: z.boolean().optional() })),
          responses: { "200": ok("The grant"), ...ERRORS },
        },
        delete: {
          tags: ["Knowledge base"],
          summary: "Withdraw a key's grant",
          responses: { "204": { description: "Withdrawn" }, ...ERRORS },
        },
      },
      "/external-refs": {
        put: {
          tags: ["Integrations"],
          summary: "Map a record to an id in another system",
          requestBody: body(externalRefInputSchema),
          responses: { "200": ok("The stored mapping"), ...ERRORS },
        },
      },
      "/lookup": {
        get: {
          tags: ["Integrations"],
          summary: "Find a record by its id in another system",
          parameters: [
            { name: "system", in: "query", required: true, schema: { type: "string" } },
            {
              name: "entity",
              in: "query",
              schema: { type: "string", enum: ["company", "location", "document"] },
            },
            { name: "external_id", in: "query", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": ok("The company with its locations and documents"),
            ...ERRORS,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        authToken: {
          type: "apiKey",
          in: "header",
          name: "X-Auth-Token",
          description: `The API key, bare or after "Bearer ". Scopes: ${API_SCOPES.join(", ")}. admin implies write, write implies read.`,
        },
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: `Scopes: ${API_SCOPES.join(", ")}. admin implies write, write implies read.`,
        },
      },
      schemas: {
        Error: jsonSchema(errorSchema),
        CompanyInput: jsonSchema(companyInputSchema),
        LocationInput: jsonSchema(locationInputSchema),
        FieldType: { type: "string", enum: [...FIELD_TYPES] },
        KbArticleInput: jsonSchema(kbUpsertBodySchema),
      },
      responses: {
        Unauthorized: ok("No or invalid API key", "Error"),
        Forbidden: ok("The key lacks the required scope", "Error"),
        NotFound: ok("No such record", "Error"),
        InvalidRequest: ok("The request body or query was rejected", "Error"),
        RateLimited: ok("Too many requests", "Error"),
      },
    },
    webhooks: {
      "document.updated": {
        post: {
          summary: "Sent when a document is saved",
          description:
            "Signed with HMAC-SHA256 in X-Trove-Signature, with X-Trove-Event and X-Trove-Delivery alongside.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    event: { type: "string" },
                    occurred_at: { type: "string", format: "date-time" },
                    data: { type: "object" },
                  },
                  required: ["event", "occurred_at", "data"],
                },
              },
            },
          },
          responses: { "200": { description: "Acknowledged" } },
        },
      },
    },
  };
}
