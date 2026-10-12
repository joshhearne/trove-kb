import "server-only";
import type { FieldDefinition } from "@/server/fields/types";

/** Value a ticked checkbox submits. Mirrored by the FieldInput component. */
export const CHECKED = "on";

/** The form control name carrying a field's value. Keyed by UUID, never label. */
export function fieldInputName(fieldId: string): string {
  return `field:${fieldId}`;
}

/**
 * Pulls one field's raw value out of a submitted form, shaped the way its
 * validator expects. Validation itself lives in fields/values.ts.
 */
export function readRawValue(formData: FormData, field: FieldDefinition): unknown {
  const key = fieldInputName(field.id);

  switch (field.fieldType) {
    case "boolean":
      // Checkbox controls carry a blank hidden input of the same name, so the
      // key is always present; "on" only appears when the box is ticked.
      return formData.getAll(key).includes(CHECKED);

    case "number": {
      const raw = formData.get(key);
      if (typeof raw !== "string" || raw.trim() === "") return null;
      return Number(raw);
    }

    case "multi_dropdown":
    case "ip_list":
      return formData.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");


    default: {
      const raw = formData.get(key);
      return typeof raw === "string" ? raw : null;
    }
  }
}

/**
 * Raw values for the fields the form actually carried, keyed by field UUID.
 * A field whose control is absent is left out entirely, so a partial submit
 * merges rather than wiping values it never showed. An empty control is still
 * present, and still means "clear this field".
 */
export function readRawValues(
  formData: FormData,
  fields: FieldDefinition[],
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.archivedAt) continue;
    if (!formData.has(fieldInputName(field.id))) continue;
    raw[field.id] = readRawValue(formData, field);
  }
  return raw;
}
