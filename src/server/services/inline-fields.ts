import "server-only";
import { z } from "zod";
import { MAC_FORMATS } from "@/lib/net/mac";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { documents, fields } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { queueEvent } from "@/server/services/webhooks";
import { NotFoundError } from "@/server/services/companies";
import { assertDocumentInScope } from "@/server/services/documents";
import { assertInScope, type CompanyScope } from "@/server/auth/company-scope";
import {
  EDITABLE_FIELD_TYPES,
  usesLinkDocType,
  usesMacFormat,
  usesOptionList,
  type FieldDefinition,
} from "@/server/fields/types";

/**
 * Inline field operations run from inside a document, never from an admin
 * screen (CLAUDE.md: users must never leave a document to add a field, add a
 * dropdown option, or reorder fields).
 */

export const localFieldInputSchema = z
  .object({
    label: z.string().trim().min(1, "Label is required").max(200),
    fieldType: z.enum(EDITABLE_FIELD_TYPES),
    optionListId: z.uuid().optional().nullable(),
    linkDocTypeId: z.uuid().optional().nullable(),
    macFormat: z.enum(MAC_FORMATS).optional().nullable(),
    required: z.boolean().default(false),
  })
  .refine((v) => !usesOptionList(v.fieldType) || !!v.optionListId, {
    message: "Choose an option list for a dropdown field",
    path: ["optionListId"],
  })
  .refine((v) => usesOptionList(v.fieldType) || !v.optionListId, {
    message: "Only dropdown fields use an option list",
    path: ["optionListId"],
  })
  .refine((v) => usesLinkDocType(v.fieldType) || !v.linkDocTypeId, {
    message: "Only a link field points at a doc type",
    path: ["linkDocTypeId"],
  })
  .refine((v) => usesMacFormat(v.fieldType) || !v.macFormat, {
    message: "Only a MAC address field has a format",
    path: ["macFormat"],
  });

export type LocalFieldInput = z.infer<typeof localFieldInputSchema>;

const FIELD_COLUMNS = {
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
};

/** Adds a field that belongs to this document alone. */
export async function addLocalField(
  documentId: string,
  input: z.input<typeof localFieldInputSchema>,
  actorId: string,
  scope: CompanyScope,
): Promise<FieldDefinition> {
  await assertDocumentInScope(documentId, scope);
  const data = localFieldInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [document] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!document) throw new NotFoundError("Document");

    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${fields.sortOrder}), -1) + 1` })
      .from(fields)
      .where(eq(fields.documentId, documentId));

    const [field] = await tx
      .insert(fields)
      .values({
        documentId,
        label: data.label,
        fieldType: data.fieldType,
        optionListId: data.optionListId ?? null,
        linkDocTypeId: data.linkDocTypeId ?? null,
        macFormat: data.macFormat ?? null,
        required: data.required,
        sortOrder: next,
      })
      .returning(FIELD_COLUMNS);
    if (!field) throw new Error("Failed to add field");

    await writeAudit(
      {
        userId: actorId,
        action: "field.added_local",
        entity: "field",
        entityId: field.id,
        detail: { documentId, label: data.label, fieldType: data.fieldType },
      },
      tx,
    );

    return field as FieldDefinition;
  });
}

export class NotALocalFieldError extends Error {
  constructor() {
    super("Only a field belonging to this document can be promoted");
    this.name = "NotALocalFieldError";
  }
}

/**
 * "Add to template": set doc_type_id, clear document_id. One UPDATE, exactly as
 * ARCHITECTURE describes. Existing documents of that type pick the field up
 * empty, because values are keyed by field UUID.
 */
export async function promoteField(
  fieldId: string,
  input: z.input<typeof localFieldInputSchema>,
  actorId: string,
  scope: CompanyScope,
): Promise<FieldDefinition> {
  await assertFieldInScope(fieldId, scope);
  const data = localFieldInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: fields.id, documentId: fields.documentId })
      .from(fields)
      .where(eq(fields.id, fieldId))
      .limit(1);
    if (!existing) throw new NotFoundError("Field");
    if (!existing.documentId) throw new NotALocalFieldError();

    const [document] = await tx
      .select({ docTypeId: documents.docTypeId })
      .from(documents)
      .where(eq(documents.id, existing.documentId))
      .limit(1);
    if (!document) throw new NotFoundError("Document");

    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${fields.sortOrder}), -1) + 1` })
      .from(fields)
      .where(eq(fields.docTypeId, document.docTypeId));

    const [promoted] = await tx
      .update(fields)
      .set({
        docTypeId: document.docTypeId,
        documentId: null,
        label: data.label,
        fieldType: data.fieldType,
        optionListId: data.optionListId ?? null,
        linkDocTypeId: data.linkDocTypeId ?? null,
        macFormat: data.macFormat ?? null,
        required: data.required,
        sortOrder: next,
      })
      .where(eq(fields.id, fieldId))
      .returning(FIELD_COLUMNS);
    if (!promoted) throw new Error("Failed to promote field");

    await writeAudit(
      {
        userId: actorId,
        action: "field.promoted",
        entity: "field",
        entityId: fieldId,
        detail: {
          docTypeId: document.docTypeId,
          fromDocumentId: existing.documentId,
          label: data.label,
        },
      },
      tx,
    );

    await queueEvent(
      "field.promoted",
      {
        field_id: fieldId,
        doc_type_id: document.docTypeId,
        label: data.label,
        type: data.fieldType,
      },
      tx,
    );

    return promoted as FieldDefinition;
  });
}

/** Reorder that applies to this document only: writes documents.field_order. */
export async function setDocumentFieldOrder(
  documentId: string,
  orderedFieldIds: string[],
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(documents)
      .set({ fieldOrder: orderedFieldIds })
      .where(eq(documents.id, documentId))
      .returning({ id: documents.id });
    if (!updated) throw new NotFoundError("Document");

    await writeAudit(
      {
        userId: actorId,
        action: "document.field_order_set",
        entity: "document",
        entityId: documentId,
        detail: { order: orderedFieldIds },
      },
      tx,
    );
  });
}

/**
 * Reorder that applies to the whole template: writes fields.sort_order and
 * clears this document's override so it follows the template again.
 */
export async function applyOrderToTemplate(
  documentId: string,
  docTypeId: string,
  orderedFieldIds: string[],
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertDocumentInScope(documentId, scope);
  await db.transaction(async (tx) => {
    const templateFieldIds = new Set(
      (
        await tx
          .select({ id: fields.id })
          .from(fields)
          .where(eq(fields.docTypeId, docTypeId))
      ).map((row) => row.id),
    );

    let position = 0;
    for (const fieldId of orderedFieldIds) {
      if (!templateFieldIds.has(fieldId)) continue; // local fields keep their own order
      await tx.update(fields).set({ sortOrder: position }).where(eq(fields.id, fieldId));
      position += 1;
    }

    // Local fields keep a document-level order, so the override still matters
    // whenever the document has any.
    const localFieldIds = orderedFieldIds.filter((id) => !templateFieldIds.has(id));
    await tx
      .update(documents)
      .set({ fieldOrder: localFieldIds.length > 0 ? orderedFieldIds : null })
      .where(eq(documents.id, documentId));

    await writeAudit(
      {
        userId: actorId,
        action: "field.reordered",
        entity: "doc_type",
        entityId: docTypeId,
        detail: { order: orderedFieldIds, fromDocumentId: documentId },
      },
      tx,
    );
  });
}

/** Archives a field from inside a document. Stored values stay in JSONB. */
export async function archiveFieldInline(
  fieldId: string,
  actorId: string,
  scope: CompanyScope,
): Promise<void> {
  await assertFieldInScope(fieldId, scope);
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(fields)
      .set({ archivedAt: new Date() })
      .where(and(eq(fields.id, fieldId), isNull(fields.archivedAt)))
      .returning({ id: fields.id, documentId: fields.documentId, docTypeId: fields.docTypeId });
    if (!updated) throw new NotFoundError("Active field");

    await writeAudit(
      {
        userId: actorId,
        action: "field.archived",
        entity: "field",
        entityId: fieldId,
        detail: { documentId: updated.documentId, docTypeId: updated.docTypeId },
      },
      tx,
    );
  });
}

/** Whether a field belongs to one document (local) or to a doc type (template). */
/**
 * A local field belongs to one document, so its company decides who may touch
 * it. A template field belongs to a doc type, which is instance-wide and
 * already admin-only, so there is nothing per-company to check.
 */
async function assertFieldInScope(fieldId: string, scope: CompanyScope): Promise<void> {
  const ownership = await getFieldOwnership(fieldId);
  if (!ownership) throw new NotFoundError("Field");
  if (!ownership.documentId) return;

  const [row] = await db
    .select({ companyId: documents.companyId })
    .from(documents)
    .where(eq(documents.id, ownership.documentId))
    .limit(1);
  if (!row) throw new NotFoundError("Field");
  assertInScope(scope, row.companyId, "Field");
}

export async function getFieldOwnership(
  fieldId: string,
): Promise<{ documentId: string | null; docTypeId: string | null } | null> {
  const [field] = await db
    .select({ documentId: fields.documentId, docTypeId: fields.docTypeId })
    .from(fields)
    .where(eq(fields.id, fieldId))
    .limit(1);
  return field ?? null;
}

/** Template fields of a doc type, oldest order first. Used after a promote. */
export async function listTemplateFieldIds(docTypeId: string): Promise<string[]> {
  const rows = await db
    .select({ id: fields.id })
    .from(fields)
    .where(and(eq(fields.docTypeId, docTypeId), isNull(fields.archivedAt)))
    .orderBy(asc(fields.sortOrder), asc(fields.label));
  return rows.map((row) => row.id);
}
