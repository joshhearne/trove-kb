import { htmlToText } from "@/server/fields/sanitize";
import { renderMarkdown } from "@/server/fields/render";
import type { FieldDefinition, FieldType } from "@/server/fields/types";
import {
  isEmptyValue,
  validateFieldValue,
  type OptionIndex,
  type ValidationContext,
} from "@/server/fields/values";
import type { MacFormat } from "@/lib/net/mac";

/** What the value's old field looked like before the change. */
export type PreviousField = {
  fieldType: FieldType;
  /** Labels of the old option list's items, archived ones included. */
  optionLabels?: Map<string, string>;
};

export type ConvertContext = {
  /** Option items for the field's new option list. */
  options?: OptionIndex;
  macFormat?: MacFormat;
};

export type ConvertResult = { ok: true; value: unknown } | { ok: false };

/** Types whose stored value means nothing outside the field that wrote it. */
const UNPORTABLE: readonly FieldType[] = ["doc_link", "secret_ref"];

const NUMERIC: readonly FieldType[] = ["number", "vlan", "asn"];
const LISTS: readonly FieldType[] = ["ip_list", "port_list", "multi_dropdown"];
const FREE_TEXT: readonly FieldType[] = ["text", "markdown", "richtext"];

/**
 * The stored value as plain text, or a list of plain text for list types.
 * Undefined when the value can't be read that way.
 */
function asText(previous: PreviousField, value: unknown): string | string[] | undefined {
  switch (previous.fieldType) {
    case "dropdown":
      return typeof value === "string" ? previous.optionLabels?.get(value) : undefined;
    case "multi_dropdown": {
      if (!Array.isArray(value)) return undefined;
      const labels = value.map((id) =>
        typeof id === "string" ? previous.optionLabels?.get(id) : undefined,
      );
      return labels.every((label): label is string => label !== undefined) ? labels : undefined;
    }
    case "richtext":
      return typeof value === "string" ? htmlToText(value) : undefined;
    case "boolean":
      // "Yes"/"No" would be one locale's words baked into the data.
      return undefined;
    default:
      if (Array.isArray(value)) return value.map((item) => String(item));
      if (typeof value === "string") return value;
      if (typeof value === "number") return String(value);
      return undefined;
  }
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "on"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "off"]);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Shapes plain text into what the new type's validator accepts. */
function toInput(
  previous: PreviousField,
  field: FieldDefinition,
  text: string | string[],
  ctx: ConvertContext,
): unknown {
  const target = field.fieldType;
  const single = Array.isArray(text) ? (text.length === 1 ? text[0] : undefined) : text;

  if (LISTS.includes(target)) {
    const items = Array.isArray(text) ? text : [text];
    if (target !== "multi_dropdown") return Array.isArray(text) ? items : text;
    const choices = field.optionListId ? (ctx.options?.get(field.optionListId) ?? []) : [];
    const ids = items.map(
      (item) => choices.find((o) => o.label.trim().toLowerCase() === item.trim().toLowerCase())?.id,
    );
    return ids.every((id) => id !== undefined) ? ids : undefined;
  }

  if (FREE_TEXT.includes(target)) {
    const joined = Array.isArray(text) ? text.join(", ") : text;
    if (target !== "richtext") return joined;
    if (previous.fieldType === "markdown") return renderMarkdown(joined);
    return joined
      .split(/\n{2,}/)
      .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  if (single === undefined) return undefined;
  const trimmed = single.trim();

  if (NUMERIC.includes(target)) {
    if (target === "asn") return trimmed; // the AS parser reads "AS13335" too
    const number = Number(trimmed);
    return trimmed !== "" && Number.isFinite(number) ? number : undefined;
  }

  switch (target) {
    case "boolean": {
      const word = trimmed.toLowerCase();
      if (TRUE_WORDS.has(word)) return true;
      if (FALSE_WORDS.has(word)) return false;
      return undefined;
    }
    case "dropdown": {
      const choices = field.optionListId ? (ctx.options?.get(field.optionListId) ?? []) : [];
      return choices.find((o) => o.label.trim().toLowerCase() === trimmed.toLowerCase())?.id;
    }
    case "date":
      return trimmed.slice(0, 10);
    default:
      return trimmed;
  }
}

/**
 * Converts a value stored under a field's old type into its new type: "10"
 * becomes the VLAN number 10, a dropdown option becomes its label in a text
 * field, and so on. Returns { ok: false } when the value doesn't fit; callers
 * keep it as it was rather than lose it.
 */
export function convertFieldValue(
  previous: PreviousField,
  field: FieldDefinition,
  value: unknown,
  ctx: ConvertContext = {},
): ConvertResult {
  if (isEmptyValue(value)) return { ok: false };
  if (UNPORTABLE.includes(previous.fieldType) || UNPORTABLE.includes(field.fieldType)) {
    return { ok: false };
  }

  const text = asText(previous, value);
  if (text === undefined) return { ok: false };
  const input = toInput(previous, field, text, ctx);
  if (input === undefined) return { ok: false };

  // A required field still converts; an empty result is never written.
  const validation: ValidationContext = { options: ctx.options, macFormat: ctx.macFormat };
  const result = validateFieldValue({ ...field, required: false }, input, validation);
  if (!result.ok || result.value === null) return { ok: false };
  return { ok: true, value: result.value };
}
