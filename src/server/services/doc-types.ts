import "server-only";
import { z } from "zod";
import { MAC_FORMATS } from "@/lib/net/mac";
import { isIconName } from "@/lib/icon-name";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Executor } from "@/server/db";
import { docTypes, documents, fields } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import {
  EDITABLE_FIELD_TYPES,
  usesLinkDocType,
  usesMacFormat,
  usesOptionList,
  type FieldDefinition,
} from "@/server/fields/types";

const editableFieldType = z.enum(EDITABLE_FIELD_TYPES);

export const docTypeInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  icon: z
    .string()
    .trim()
    .toLowerCase()
    .max(64)
    .refine((value) => value === "" || isIconName(value), "Use a lucide icon name, such as globe-lock")
    .optional()
    .nullable(),
  scope: z.enum(["company", "location"]),
});

export const templateFieldInputSchema = z
  .object({
    label: z.string().trim().min(1, "Label is required").max(200),
    fieldType: editableFieldType,
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

export type DocTypeInput = z.infer<typeof docTypeInputSchema>;
export type TemplateFieldInput = z.infer<typeof templateFieldInputSchema>;

export type DocTypeSummary = {
  id: string;
  name: string;
  icon: string | null;
  scope: string;
  archivedAt: Date | null;
  fieldCount: number;
  documentCount: number;
};

export async function listDocTypes(
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<DocTypeSummary[]> {
  const fieldCount = db
    .select({ docTypeId: fields.docTypeId, n: sql<number>`count(*)::int`.as("field_count") })
    .from(fields)
    .where(isNull(fields.archivedAt))
    .groupBy(fields.docTypeId)
    .as("field_counts");

  const documentCount = db
    .select({ docTypeId: documents.docTypeId, n: sql<number>`count(*)::int`.as("document_count") })
    .from(documents)
    .where(isNull(documents.archivedAt))
    .groupBy(documents.docTypeId)
    .as("doc_counts");

  return db
    .select({
      id: docTypes.id,
      name: docTypes.name,
      icon: docTypes.icon,
      scope: docTypes.scope,
      archivedAt: docTypes.archivedAt,
      fieldCount: sql<number>`coalesce(${fieldCount.n}, 0)`,
      documentCount: sql<number>`coalesce(${documentCount.n}, 0)`,
    })
    .from(docTypes)
    .leftJoin(fieldCount, eq(fieldCount.docTypeId, docTypes.id))
    .leftJoin(documentCount, eq(documentCount.docTypeId, docTypes.id))
    .where(includeArchived ? undefined : isNull(docTypes.archivedAt))
    .orderBy(asc(docTypes.name));
}

/** Template fields of a doc type, in display order. */
export async function listTemplateFields(
  docTypeId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
  tx?: Executor,
): Promise<FieldDefinition[]> {
  const exec = tx ?? db;
  return exec
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
        ? eq(fields.docTypeId, docTypeId)
        : and(eq(fields.docTypeId, docTypeId), isNull(fields.archivedAt)),
    )
    .orderBy(asc(fields.sortOrder), asc(fields.label)) as Promise<FieldDefinition[]>;
}

export async function getDocType(id: string) {
  const [docType] = await db.select().from(docTypes).where(eq(docTypes.id, id)).limit(1);
  if (!docType) return null;
  return { ...docType, fields: await listTemplateFields(id, { includeArchived: true }) };
}

export async function createDocType(
  input: z.input<typeof docTypeInputSchema>,
  actorId: string,
): Promise<{ id: string }> {
  const data = docTypeInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [docType] = await tx
      .insert(docTypes)
      .values({ name: data.name, icon: data.icon ?? null, scope: data.scope })
      .returning({ id: docTypes.id });
    if (!docType) throw new Error("Failed to create doc type");

    await writeAudit(
      {
        userId: actorId,
        action: "doc_type.created",
        entity: "doc_type",
        entityId: docType.id,
        detail: { name: data.name, scope: data.scope },
      },
      tx,
    );
    return docType;
  });
}

export async function updateDocType(
  id: string,
  input: z.input<typeof docTypeInputSchema>,
  actorId: string,
): Promise<void> {
  const data = docTypeInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(docTypes)
      .set({ name: data.name, icon: data.icon ?? null, scope: data.scope })
      .where(eq(docTypes.id, id))
      .returning({ id: docTypes.id });
    if (!updated) throw new NotFoundError("Doc type");

    await writeAudit(
      {
        userId: actorId,
        action: "doc_type.updated",
        entity: "doc_type",
        entityId: id,
        detail: { name: data.name, scope: data.scope },
      },
      tx,
    );
  });
}

/** Archive, never hard delete — documents of this type keep rendering. */
export async function archiveDocType(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(docTypes)
      .set({ archivedAt: new Date() })
      .where(and(eq(docTypes.id, id), isNull(docTypes.archivedAt)))
      .returning({ id: docTypes.id });
    if (!updated) throw new NotFoundError("Active doc type");

    await writeAudit(
      { userId: actorId, action: "doc_type.archived", entity: "doc_type", entityId: id },
      tx,
    );
  });
}

export async function unarchiveDocType(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(docTypes)
      .set({ archivedAt: null })
      .where(eq(docTypes.id, id))
      .returning({ id: docTypes.id });
    if (!updated) throw new NotFoundError("Doc type");

    await writeAudit(
      { userId: actorId, action: "doc_type.unarchived", entity: "doc_type", entityId: id },
      tx,
    );
  });
}

export async function addTemplateField(
  docTypeId: string,
  input: z.input<typeof templateFieldInputSchema>,
  actorId: string,
): Promise<{ id: string }> {
  const data = templateFieldInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${fields.sortOrder}), -1) + 1` })
      .from(fields)
      .where(eq(fields.docTypeId, docTypeId));

    const [field] = await tx
      .insert(fields)
      .values({
        docTypeId,
        label: data.label,
        fieldType: data.fieldType,
        optionListId: data.optionListId ?? null,
        linkDocTypeId: data.linkDocTypeId ?? null,
        macFormat: data.macFormat ?? null,
        required: data.required,
        sortOrder: next,
      })
      .returning({ id: fields.id });
    if (!field) throw new Error("Failed to add field");

    await writeAudit(
      {
        userId: actorId,
        action: "field.created",
        entity: "field",
        entityId: field.id,
        detail: { docTypeId, label: data.label, fieldType: data.fieldType },
      },
      tx,
    );
    return field;
  });
}

export async function updateTemplateField(
  id: string,
  input: z.input<typeof templateFieldInputSchema>,
  actorId: string,
): Promise<void> {
  const data = templateFieldInputSchema.parse(input);

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(fields)
      .set({
        label: data.label,
        fieldType: data.fieldType,
        optionListId: data.optionListId ?? null,
        linkDocTypeId: data.linkDocTypeId ?? null,
        macFormat: data.macFormat ?? null,
        required: data.required,
      })
      .where(eq(fields.id, id))
      .returning({ id: fields.id });
    if (!updated) throw new NotFoundError("Field");

    await writeAudit(
      {
        userId: actorId,
        action: "field.updated",
        entity: "field",
        entityId: id,
        detail: { label: data.label, fieldType: data.fieldType },
      },
      tx,
    );
  });
}

/** Hides the field everywhere. Stored values stay in JSONB so revisions render. */
export async function archiveField(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(fields)
      .set({ archivedAt: new Date() })
      .where(and(eq(fields.id, id), isNull(fields.archivedAt)))
      .returning({ id: fields.id });
    if (!updated) throw new NotFoundError("Active field");

    await writeAudit({ userId: actorId, action: "field.archived", entity: "field", entityId: id }, tx);
  });
}

export async function unarchiveField(id: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(fields)
      .set({ archivedAt: null })
      .where(eq(fields.id, id))
      .returning({ id: fields.id });
    if (!updated) throw new NotFoundError("Field");

    await writeAudit(
      { userId: actorId, action: "field.unarchived", entity: "field", entityId: id },
      tx,
    );
  });
}

/** Writes a new order for the given template fields, one UPDATE per field. */
export async function reorderTemplateFields(
  docTypeId: string,
  orderedFieldIds: string[],
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, fieldId] of orderedFieldIds.entries()) {
      await tx
        .update(fields)
        .set({ sortOrder: index })
        .where(and(eq(fields.id, fieldId), eq(fields.docTypeId, docTypeId)));
    }

    await writeAudit(
      {
        userId: actorId,
        action: "field.reordered",
        entity: "doc_type",
        entityId: docTypeId,
        detail: { order: orderedFieldIds },
      },
      tx,
    );
  });
}
