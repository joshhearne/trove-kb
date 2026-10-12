import "server-only";
import { z } from "zod";
import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, type Tx } from "@/server/db";
import {
  docTypes,
  documentLinks,
  documentRevisions,
  documents,
  fields,
  locations,
} from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { getMacFormat } from "@/server/services/settings";
import type { MacFormat } from "@/lib/net/mac";
import { queueEvent } from "@/server/services/webhooks";
import { serializeDocument } from "@/server/api/serializers";
import { NotFoundError } from "@/server/services/companies";
import {
  assertInScope,
  isInScope,
  scopeWhere,
  type CompanyScope,
} from "@/server/auth/company-scope";
import { listTemplateFields } from "@/server/services/doc-types";
import { loadOptionIndex, loadOptionLabels } from "@/server/services/option-lists";
import type { FieldDefinition } from "@/server/fields/types";
import {
  flattenForSearch,
  mergeFieldValues,
  validateFieldValues,
  type LinkTargetIndex,
  type OptionIndex,
  type SecretItemIndex,
  type ValidationContext,
} from "@/server/fields/values";
import { listCompanyCollections, listCompanyVaultItems, toSecretRef } from "@/server/services/vault";

export type DocumentListItem = {
  id: string;
  title: string;
  updatedAt: Date;
  docTypeId: string;
  docTypeName: string;
  docTypeIcon: string | null;
  docTypeScope: string;
  locationId: string | null;
  locationName: string | null;
};

export type DocumentGroup = {
  docType: { id: string; name: string; icon: string | null; scope: string };
  documents: DocumentListItem[];
};

/** Active documents belonging to a company, with their doc type and location joined. */
export async function listCompanyDocuments(
  companyId: string,
  scope: CompanyScope,
): Promise<DocumentListItem[]> {
  assertInScope(scope, companyId);
  return db
    .select({
      id: documents.id,
      title: documents.title,
      updatedAt: documents.updatedAt,
      docTypeId: docTypes.id,
      docTypeName: docTypes.name,
      docTypeIcon: docTypes.icon,
      docTypeScope: docTypes.scope,
      locationId: locations.id,
      locationName: locations.name,
    })
    .from(documents)
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .leftJoin(locations, eq(locations.id, documents.locationId))
    .where(and(eq(documents.companyId, companyId), isNull(documents.archivedAt)))
    .orderBy(asc(docTypes.name), asc(documents.title));
}

/**
 * Groups documents under their doc type, preserving the order they arrive in.
 * Pure so the company page's shape can be tested without a database.
 */
export function groupByDocType(rows: DocumentListItem[]): DocumentGroup[] {
  const groups = new Map<string, DocumentGroup>();

  for (const row of rows) {
    let group = groups.get(row.docTypeId);
    if (!group) {
      group = {
        docType: {
          id: row.docTypeId,
          name: row.docTypeName,
          icon: row.docTypeIcon,
          scope: row.docTypeScope,
        },
        documents: [],
      };
      groups.set(row.docTypeId, group);
    }
    group.documents.push(row);
  }

  return [...groups.values()];
}

export async function listCompanyDocumentsGrouped(
  companyId: string,
  scope: CompanyScope,
): Promise<DocumentGroup[]> {
  return groupByDocType(await listCompanyDocuments(companyId, scope));
}

/**
 * Template fields first, then the document's own local fields, with an explicit
 * `field_order` winning when the document has one (ARCHITECTURE, inline editing
 * rule 1). Unknown ids in `field_order` are ignored; fields missing from it keep
 * their natural position at the end.
 */
export function orderFields(
  templateFields: FieldDefinition[],
  localFields: FieldDefinition[],
  fieldOrder: string[] | null,
): FieldDefinition[] {
  const natural = [...templateFields, ...localFields];
  if (!fieldOrder || fieldOrder.length === 0) return natural;

  const byId = new Map(natural.map((field) => [field.id, field]));
  const ordered: FieldDefinition[] = [];

  for (const id of fieldOrder) {
    const field = byId.get(id);
    if (field) {
      ordered.push(field);
      byId.delete(id);
    }
  }
  for (const field of natural) {
    if (byId.has(field.id)) ordered.push(field);
  }

  return ordered;
}

async function listLocalFields(
  documentId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<FieldDefinition[]> {
  return db
    .select({
      id: fields.id,
      label: fields.label,
      fieldType: fields.fieldType,
      optionListId: fields.optionListId,
      linkDocTypeId: fields.linkDocTypeId,
      required: fields.required,
      sortOrder: fields.sortOrder,
      macFormat: fields.macFormat,
      archivedAt: fields.archivedAt,
      docTypeId: fields.docTypeId,
      documentId: fields.documentId,
    })
    .from(fields)
    .where(
      includeArchived
        ? eq(fields.documentId, documentId)
        : and(eq(fields.documentId, documentId), isNull(fields.archivedAt)),
    )
    .orderBy(asc(fields.sortOrder), asc(fields.label)) as Promise<FieldDefinition[]>;
}

/**
 * The documents each doc_link field may point at: same company, active, the
 * right doc type when the field names one, and never the document itself.
 */
export async function loadLinkTargets(
  fieldList: FieldDefinition[],
  companyId: string,
  selfDocumentId: string | null,
): Promise<LinkTargetIndex> {
  const index: LinkTargetIndex = new Map();
  const linkFields = fieldList.filter((field) => field.fieldType === "doc_link");
  if (linkFields.length === 0) return index;

  const rows = await db
    .select({ id: documents.id, title: documents.title, docTypeId: documents.docTypeId })
    .from(documents)
    .where(and(eq(documents.companyId, companyId), isNull(documents.archivedAt)))
    .orderBy(asc(documents.title));

  for (const field of linkFields) {
    const candidates = new Map<string, string>();
    for (const row of rows) {
      if (row.id === selfDocumentId) continue;
      if (field.linkDocTypeId && row.docTypeId !== field.linkDocTypeId) continue;
      candidates.set(row.id, row.title);
    }
    index.set(field.id, candidates);
  }

  return index;
}

/** Titles for documents already linked, archived ones included, for rendering. */
async function loadLinkedTitles(documentIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(documentIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(inArray(documents.id, ids));
  return new Map(rows.map((row) => [row.id, row.title]));
}

/**
 * Mirrors the document's doc_link values into document_links, which is what
 * backlinks are read from. Rewritten wholesale on every save.
 */
async function syncDocumentLinks(
  tx: Tx,
  documentId: string,
  fieldList: FieldDefinition[],
  values: Record<string, unknown>,
): Promise<void> {
  await tx.delete(documentLinks).where(eq(documentLinks.fromDoc, documentId));

  const rows = fieldList
    .filter((field) => field.fieldType === "doc_link")
    .flatMap((field) => {
      const target = values[field.id];
      return typeof target === "string" && target !== ""
        ? [{ fromDoc: documentId, toDoc: target, fieldId: field.id }]
        : [];
    });

  if (rows.length > 0) await tx.insert(documentLinks).values(rows).onConflictDoNothing();
}

export type Backlink = {
  documentId: string;
  title: string;
  docTypeName: string;
  fieldLabel: string;
};

/**
 * Documents pointing at this one, for the "Linked from" section. A link may
 * come from a company the reader has no access to, so the scope is applied
 * here too: otherwise a backlink would disclose a document's title, its doc
 * type, and the fact that the company exists.
 */
export async function listBacklinks(
  documentId: string,
  scope: CompanyScope,
): Promise<Backlink[]> {
  return db
    .select({
      documentId: documents.id,
      title: documents.title,
      docTypeName: docTypes.name,
      fieldLabel: fields.label,
    })
    .from(documentLinks)
    .innerJoin(documents, eq(documents.id, documentLinks.fromDoc))
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .innerJoin(fields, eq(fields.id, documentLinks.fieldId))
    .where(
      and(
        eq(documentLinks.toDoc, documentId),
        isNull(documents.archivedAt),
        scopeWhere(scope, documents.companyId),
      ),
    )
    .orderBy(asc(docTypes.name), asc(documents.title));
}

export type VaultContext = {
  providerId: string;
  status: string;
  brokering: boolean;
  allowCreate: boolean;
  webVaultUrl: string | null;
  collectionIds: string[];
};

/**
 * Vault items each secret_ref field may reference, scoped to the collections
 * mapped to this company (docs/VAULT_INTEGRATION.md: no cross-client leakage).
 */
export async function loadSecretItems(
  fieldList: FieldDefinition[],
  companyId: string,
  scope: CompanyScope,
): Promise<{ index: SecretItemIndex; vault: VaultContext | null }> {
  const index: SecretItemIndex = new Map();
  const secretFields = fieldList.filter((field) => field.fieldType === "secret_ref");
  if (secretFields.length === 0) return { index, vault: null };

  const { items, vault } = await listCompanyVaultItems(companyId, scope);
  if (!vault) return { index, vault: null };

  const collectionIds = await listCompanyCollections(companyId, vault.row.id);

  for (const field of secretFields) {
    const byItem = new Map<string, Record<string, unknown>>();
    for (const item of items) {
      byItem.set(item.id, toSecretRef(vault.row.id, item, collectionIds) as unknown as Record<string, unknown>);
    }
    index.set(field.id, byItem);
  }

  return {
    index,
    vault: {
      providerId: vault.row.id,
      status: vault.status,
      brokering: vault.brokering,
      allowCreate: vault.row.allowCreate,
      webVaultUrl: vault.row.webVaultUrl,
      collectionIds,
    },
  };
}

export type DocumentDetail = {
  document: typeof documents.$inferSelect;
  docType: typeof docTypes.$inferSelect;
  location: { id: string; name: string } | null;
  fields: FieldDefinition[];
  optionIndex: OptionIndex;
  /** Every option label, archived included, so stored values still render. */
  optionLabels: Map<string, string>;
  /** Documents each doc_link field may point at. */
  linkTargets: LinkTargetIndex;
  /** Titles of documents already linked, archived ones included. */
  linkedTitles: Map<string, string>;
  /** Vault items each secret_ref field may reference. */
  secretItems: SecretItemIndex;
  /** Null when the document has no secret_ref field. */
  vault: VaultContext | null;
  /** The instance's MAC format, for mac fields without one of their own. */
  macFormat: MacFormat;
};

/**
 * Throws "not found" unless the document belongs to a company in scope. The
 * mutations take a document id and nothing else, so this is where they learn
 * whose document it is.
 */
export async function assertDocumentInScope(id: string, scope: CompanyScope): Promise<string> {
  const [row] = await db
    .select({ companyId: documents.companyId })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (!row) throw new NotFoundError("Document");
  assertInScope(scope, row.companyId, "Document");
  return row.companyId;
}

export async function getDocumentDetail(
  id: string,
  scope: CompanyScope,
): Promise<DocumentDetail | null> {
  const [row] = await db
    .select({ document: documents, docType: docTypes })
    .from(documents)
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .where(eq(documents.id, id))
    .limit(1);
  if (!row || !isInScope(scope, row.document.companyId)) return null;

  const [templateFields, localFields] = await Promise.all([
    listTemplateFields(row.docType.id),
    listLocalFields(id),
  ]);

  const ordered = orderFields(templateFields, localFields, row.document.fieldOrder ?? null);
  const listIds = ordered.flatMap((field) => (field.optionListId ? [field.optionListId] : []));

  const [optionIndex, optionLabels, location] = await Promise.all([
    loadOptionIndex(listIds),
    loadOptionLabels(listIds),
    row.document.locationId
      ? db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(eq(locations.id, row.document.locationId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const linkedIds = ordered
    .filter((field) => field.fieldType === "doc_link")
    .map((field) => row.document.fieldValues?.[field.id])
    .filter((value): value is string => typeof value === "string" && value !== "");

  const [linkTargets, linkedTitles, secrets, macFormat] = await Promise.all([
    loadLinkTargets(ordered, row.document.companyId, row.document.id),
    loadLinkedTitles(linkedIds),
    loadSecretItems(ordered, row.document.companyId, scope),
    getMacFormat(),
  ]);

  return {
    document: row.document,
    docType: row.docType,
    location,
    fields: ordered,
    optionIndex,
    optionLabels,
    linkTargets,
    linkedTitles,
    secretItems: secrets.index,
    vault: secrets.vault,
    macFormat,
  };
}

export const documentInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(300),
});

export class ScopeMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeMismatchError";
  }
}

export type SaveResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

/**
 * A company-scoped doc type takes no location; a location-scoped one requires a
 * location belonging to the same company.
 */
async function assertScope(
  docTypeId: string,
  companyId: string,
  locationId: string | null,
): Promise<void> {
  const [docType] = await db
    .select({ scope: docTypes.scope, name: docTypes.name })
    .from(docTypes)
    .where(eq(docTypes.id, docTypeId))
    .limit(1);
  if (!docType) throw new NotFoundError("Doc type");

  if (docType.scope === "company") {
    if (locationId) throw new ScopeMismatchError(`${docType.name} documents attach to the company`);
    return;
  }

  if (!locationId) throw new ScopeMismatchError(`${docType.name} documents need a location`);

  const [location] = await db
    .select({ companyId: locations.companyId })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!location) throw new NotFoundError("Location");
  if (location.companyId !== companyId) {
    throw new ScopeMismatchError("That location belongs to another company");
  }
}

export async function createDocument(
  input: {
    companyId: string;
    docTypeId: string;
    locationId: string | null;
    title: string;
    values?: Record<string, unknown>;
  },
  actorId: string | null,
  scope: CompanyScope,
): Promise<SaveResult> {
  assertInScope(scope, input.companyId);
  const { title } = documentInputSchema.parse({ title: input.title });
  await assertScope(input.docTypeId, input.companyId, input.locationId);

  const templateFields = await listTemplateFields(input.docTypeId);
  const [optionIndex, linkTargets, secrets, macFormat] = await Promise.all([
    loadOptionIndex(templateFields.flatMap((f) => (f.optionListId ? [f.optionListId] : []))),
    loadLinkTargets(templateFields, input.companyId, null),
    loadSecretItems(templateFields, input.companyId, scope),
    getMacFormat(),
  ]);
  const ctx: ValidationContext = {
    options: optionIndex,
    linkTargets,
    secretItems: secrets.index,
    macFormat,
  };

  const raw = input.values ?? {};
  // A new document must satisfy every required field, so treat absent as blank.
  const submitted: Record<string, unknown> = {};
  for (const field of templateFields) submitted[field.id] = raw[field.id] ?? null;

  const { values, errors } = validateFieldValues(templateFields, submitted, ctx);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const fieldValues = mergeFieldValues({}, values);
  const searchText = flattenForSearch(templateFields, fieldValues, ctx);

  const id = await db.transaction(async (tx) => {
    const [document] = await tx
      .insert(documents)
      .values({
        docTypeId: input.docTypeId,
        companyId: input.companyId,
        locationId: input.locationId,
        title,
        fieldValues,
        searchText,
        updatedBy: actorId,
      })
      .returning({ id: documents.id });
    if (!document) throw new Error("Failed to create document");

    await syncDocumentLinks(tx, document.id, templateFields, fieldValues);

    await tx.insert(documentRevisions).values({
      documentId: document.id,
      title,
      fieldValues,
      editedBy: actorId,
    });

    await writeAudit(
      {
        userId: actorId,
        action: "document.created",
        entity: "document",
        entityId: document.id,
        detail: { companyId: input.companyId, docTypeId: input.docTypeId, title },
      },
      tx,
    );

    /*
     * A doc type may carry a review schedule, and every document of that type
     * starts with it. Stamped here rather than after the fact, so a document
     * never exists without the schedule its type says it should have.
     */
    const { stampScheduleFromDocType } = await import("@/server/services/schedules");
    await stampScheduleFromDocType(tx, document.id, input.docTypeId);

    await queueEvent("document.created", { id: document.id, title }, tx);

    return document.id;
  });

  return { ok: true, id };
}

/**
 * Applies a partial map of raw field values, keyed by field UUID, to a document.
 * One transaction writes the document, a revision of the resulting version, and
 * an audit entry — the three things CLAUDE.md requires of every save.
 */
export async function saveDocument(
  id: string,
  input: { title?: string; values?: Record<string, unknown> },
  actorId: string | null,
  scope: CompanyScope,
): Promise<SaveResult> {
  const detail = await getDocumentDetail(id, scope);
  if (!detail) throw new NotFoundError("Document");

  const errors: Record<string, string> = {};

  let title = detail.document.title;
  if (input.title !== undefined) {
    const parsed = documentInputSchema.safeParse({ title: input.title });
    if (parsed.success) title = parsed.data.title;
    else errors["title"] = parsed.error.issues[0]?.message ?? "Invalid title";
  }

  const ctx: ValidationContext = {
    options: detail.optionIndex,
    linkTargets: detail.linkTargets,
    secretItems: detail.secretItems,
    macFormat: detail.macFormat,
  };
  const validated = validateFieldValues(detail.fields, input.values ?? {}, ctx);
  Object.assign(errors, validated.errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const fieldValues = mergeFieldValues(
    detail.document.fieldValues ?? {},
    validated.values,
  );
  const searchText = flattenForSearch(detail.fields, fieldValues, ctx);

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ title, fieldValues, searchText, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(documents.id, id));

    await syncDocumentLinks(tx, id, detail.fields, fieldValues);

    await tx.insert(documentRevisions).values({
      documentId: id,
      title,
      fieldValues,
      editedBy: actorId,
    });

    await writeAudit(
      {
        userId: actorId,
        action: "document.updated",
        entity: "document",
        entityId: id,
        detail: { title, changedFields: Object.keys(validated.values) },
      },
      tx,
    );

    await queueEvent(
      "document.updated",
      serializeDocument({
        document: { ...detail.document, title, fieldValues, updatedAt: new Date() },
        docType: detail.docType,
        location: detail.location,
        fields: detail.fields,
        optionLabels: detail.optionLabels,
        linkedTitles: detail.linkedTitles,
        redactSecrets: true,
      }) as unknown as Record<string, unknown>,
      tx,
    );
  });

  return { ok: true, id };
}

export async function archiveDocument(
  id: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(id, scope);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ archivedAt: new Date() })
      .where(and(eq(documents.id, id), isNull(documents.archivedAt)))
      .returning({ id: documents.id });
    if (!updated) throw new NotFoundError("Active document");

    await writeAudit(
      { userId: actorId, action: "document.archived", entity: "document", entityId: id },
      tx,
    );

    await queueEvent("document.archived", { id }, tx);
  });
}

export async function unarchiveDocument(
  id: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(id, scope);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ archivedAt: null })
      .where(eq(documents.id, id))
      .returning({ id: documents.id });
    if (!updated) throw new NotFoundError("Document");

    await writeAudit(
      { userId: actorId, action: "document.unarchived", entity: "document", entityId: id },
      tx,
    );
  });
}

export type RevisionRow = {
  id: number;
  title: string;
  fieldValues: Record<string, unknown>;
  createdAt: Date;
  editedBy: string | null;
};

/** Newest first. Each row is the state the document was left in by that save. */
export async function listRevisions(
  documentId: string,
  scope: CompanyScope,
  limit = 50,
): Promise<RevisionRow[]> {
  await assertDocumentInScope(documentId, scope);
  return db
    .select({
      id: documentRevisions.id,
      title: documentRevisions.title,
      fieldValues: documentRevisions.fieldValues,
      createdAt: documentRevisions.createdAt,
      editedBy: documentRevisions.editedBy,
    })
    .from(documentRevisions)
    .where(eq(documentRevisions.documentId, documentId))
    .orderBy(desc(documentRevisions.id))
    .limit(limit);
}

/** Doc types a company can hold documents of, split by scope. */
export async function listUsableDocTypes(hasLocations: boolean) {
  return db
    .select({ id: docTypes.id, name: docTypes.name, scope: docTypes.scope, icon: docTypes.icon })
    .from(docTypes)
    .where(
      hasLocations
        ? isNull(docTypes.archivedAt)
        : and(isNull(docTypes.archivedAt), eq(docTypes.scope, "company")),
    )
    .orderBy(asc(docTypes.name));
}

/** Keyset page ordered by (title, id), for GET /api/v1/companies/:id/documents. */
export async function listCompanyDocumentsPage(input: {
  companyId: string;
  docTypeId?: string | undefined;
  locationId?: string | undefined;
  limit: number;
  cursor: { sort: string; id: string } | null;
  scope: CompanyScope;
}) {
  assertInScope(input.scope, input.companyId);
  const filters = [eq(documents.companyId, input.companyId), isNull(documents.archivedAt)];
  if (input.docTypeId) filters.push(eq(documents.docTypeId, input.docTypeId));
  if (input.locationId) filters.push(eq(documents.locationId, input.locationId));
  if (input.cursor) {
    filters.push(
      or(
        gt(documents.title, input.cursor.sort),
        and(eq(documents.title, input.cursor.sort), gt(documents.id, input.cursor.id)),
      ) as ReturnType<typeof isNull>,
    );
  }

  return db
    .select({
      id: documents.id,
      title: documents.title,
      docTypeId: documents.docTypeId,
      docTypeName: docTypes.name,
      locationId: documents.locationId,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .where(and(...filters))
    .orderBy(asc(documents.title), asc(documents.id))
    .limit(input.limit + 1);
}
