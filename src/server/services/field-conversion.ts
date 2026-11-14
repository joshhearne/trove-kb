import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { documents, fields } from "@/server/db/schema";
import { loadOptionIndex, loadOptionLabels } from "@/server/services/option-lists";
import { getMacFormat } from "@/server/services/settings";
import { convertFieldValue } from "@/server/fields/convert";
import { flattenForSearch, type LinkTargetIndex } from "@/server/fields/values";
import type { FieldDefinition, FieldType } from "@/server/fields/types";

export type ConversionSummary = { converted: number; kept: number };

const NOTHING: ConversionSummary = { converted: 0, kept: 0 };

/** The parts of a field that decide what its stored values look like. Read straight from a row, so fieldType is plain text. */
type FieldShape = Pick<FieldDefinition, "optionListId" | "macFormat"> & { fieldType: string };

/** True when stored values may no longer match what the field accepts. */
export function needsConversion(before: FieldShape, after: FieldShape): boolean {
  if (before.fieldType !== after.fieldType) return true;
  if (before.optionListId !== after.optionListId) return true;
  return after.fieldType === "mac" && before.macFormat !== after.macFormat;
}

/** The columns that make a FieldDefinition. */
export const FIELD_DEFINITION_COLUMNS = {
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

/**
 * Rewrites every stored value of a field whose type, option list or MAC
 * format just changed, inside the transaction that changed it. Values that
 * convert are saved in the new shape and the document's search text is
 * rebuilt; values that don't fit are kept exactly as they were.
 */
export async function convertStoredValues(
  tx: Tx,
  before: FieldShape,
  after: FieldDefinition,
): Promise<ConversionSummary> {
  if (!needsConversion(before, after)) return NOTHING;

  const rows = await tx
    .select({
      id: documents.id,
      docTypeId: documents.docTypeId,
      fieldValues: documents.fieldValues,
    })
    .from(documents)
    .where(sql`${documents.fieldValues} -> ${after.id}::text is not null`);
  if (rows.length === 0) return NOTHING;

  const [options, previousLabels, macFormat] = await Promise.all([
    loadOptionIndex(after.optionListId ? [after.optionListId] : [], tx),
    before.optionListId ? loadOptionLabels([before.optionListId]) : Promise.resolve(undefined),
    getMacFormat(),
  ]);

  let kept = 0;
  const changed: { id: string; docTypeId: string; fieldValues: Record<string, unknown> }[] = [];
  for (const row of rows) {
    const stored = row.fieldValues ?? {};
    const result = convertFieldValue(
      { fieldType: before.fieldType as FieldType, optionLabels: previousLabels },
      after,
      stored[after.id],
      { options, macFormat },
    );
    if (!result.ok) {
      kept += 1;
      continue;
    }
    if (JSON.stringify(result.value) === JSON.stringify(stored[after.id])) continue;
    changed.push({
      id: row.id,
      docTypeId: row.docTypeId,
      fieldValues: { ...stored, [after.id]: result.value },
    });
  }
  if (changed.length === 0) return { converted: 0, kept };

  // Rebuild search text with each document's full, current field list.
  const docTypeIds = [...new Set(changed.map((doc) => doc.docTypeId))];
  const documentIds = changed.map((doc) => doc.id);
  const fieldRows = (await tx
    .select(FIELD_DEFINITION_COLUMNS)
    .from(fields)
    .where(
      and(
        isNull(fields.archivedAt),
        or(inArray(fields.docTypeId, docTypeIds), inArray(fields.documentId, documentIds)),
      ),
    )
    .orderBy(asc(fields.sortOrder), asc(fields.label))) as FieldDefinition[];

  const listIds = fieldRows.flatMap((field) => (field.optionListId ? [field.optionListId] : []));
  const searchOptions = await loadOptionIndex(listIds, tx);

  const linkFields = fieldRows.filter((field) => field.fieldType === "doc_link");
  const linkedIds = [
    ...new Set(
      changed.flatMap((doc) =>
        linkFields
          .map((field) => doc.fieldValues[field.id])
          .filter((value): value is string => typeof value === "string" && value !== ""),
      ),
    ),
  ];
  const titles = new Map(
    linkedIds.length === 0
      ? []
      : (
          await tx
            .select({ id: documents.id, title: documents.title })
            .from(documents)
            .where(inArray(documents.id, linkedIds))
        ).map((doc) => [doc.id, doc.title] as const),
  );
  const linkTargets: LinkTargetIndex = new Map(linkFields.map((field) => [field.id, titles]));

  for (const doc of changed) {
    const docFields = fieldRows.filter(
      (field) => field.docTypeId === doc.docTypeId || field.documentId === doc.id,
    );
    const searchText = flattenForSearch(docFields, doc.fieldValues, {
      options: searchOptions,
      linkTargets,
    });
    await tx
      .update(documents)
      .set({ fieldValues: doc.fieldValues, searchText })
      .where(eq(documents.id, doc.id));
  }

  return { converted: changed.length, kept };
}
