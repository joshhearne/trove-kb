import "server-only";
import type { FieldDefinition } from "@/server/fields/types";
import { renderFieldValue, renderMarkdown } from "@/server/fields/render";
import type { MacFormat } from "@/lib/net/mac";

/**
 * The wire shapes for /api/v1. docs/ARCHITECTURE.md asks for resolved values
 * alongside the raw ids, so every field carries both.
 */

export type ApiFieldValue = {
  field_id: string;
  label: string;
  type: string;
  required: boolean;
  /** Exactly what is stored in field_values. */
  value: unknown;
  /** Option label, linked document title, or rendered HTML. */
  resolved: string | string[] | null;
  /** True for a field that belongs to this document alone. */
  local: boolean;
};

export function serializeField(field: FieldDefinition) {
  return {
    id: field.id,
    label: field.label,
    type: field.fieldType,
    required: field.required,
    option_list_id: field.optionListId,
    link_doc_type_id: field.linkDocTypeId,
    sort_order: field.sortOrder,
    mac_format: field.macFormat,
    archived_at: field.archivedAt?.toISOString() ?? null,
  };
}

function resolve(
  field: FieldDefinition,
  value: unknown,
  optionLabels: Map<string, string>,
  linkedTitles: Map<string, string>,
  macFormat?: MacFormat,
): string | string[] | null {
  if (field.fieldType === "markdown" && typeof value === "string" && value !== "") {
    return renderMarkdown(value);
  }
  if (field.fieldType === "multi_dropdown") {
    if (!Array.isArray(value)) return null;
    const labels = value
      .map((id) => optionLabels.get(String(id)))
      .filter((label): label is string => !!label);
    return labels.length > 0 ? labels : null;
  }

  const rendered = renderFieldValue(
    field,
    value,
    optionLabels,
    linkedTitles,
    undefined,
    macFormat,
  );
  switch (rendered.kind) {
    case "text":
    case "code":
    case "mac":
      return rendered.text;
    case "ip":
      return `${rendered.address}/${rendered.prefix}`;
    case "ip_list":
      return rendered.items.map((item) =>
        item.kind === "ip" ? `${item.address}/${item.prefix}` : item.text,
      );
    case "range":
      return `${rendered.start}-${rendered.end}`;
    case "port":
      return rendered.value;
    case "port_list":
      return rendered.items.map((item) => (item.kind === "port" ? item.value : item.text));
    case "asn":
      return rendered.text;
    case "url":
      return rendered.href;
    case "html":
      return rendered.html;
    case "document":
      return rendered.title;
    case "tags":
      return rendered.labels;
    case "secret":
      // The label only. A secret never appears in an API response body.
      return rendered.label;
    case "empty":
      return null;
  }
}

export function serializeFieldValues(
  fieldList: FieldDefinition[],
  values: Record<string, unknown>,
  optionLabels: Map<string, string>,
  linkedTitles: Map<string, string> = new Map(),
  /** Webhooks carry no secret_ref payload at all (CLAUDE.md). */
  redactSecrets = false,
  /** The instance's MAC format, so `resolved` shows addresses as configured. */
  macFormat?: MacFormat,
): ApiFieldValue[] {
  return fieldList.map((field) => {
    const raw = values[field.id] ?? null;
    const secret = field.fieldType === "secret_ref";

    return {
      field_id: field.id,
      label: field.label,
      type: field.fieldType,
      required: field.required,
      value: secret && redactSecrets ? null : raw,
      resolved:
        secret && redactSecrets ? null : resolve(field, raw, optionLabels, linkedTitles, macFormat),
      local: field.documentId !== null,
    };
  });
}

export type ExternalRefPair = { system: string; external_id: string };

export function serializeCompany(
  company: {
    id: string;
    name: string;
    isInternal: boolean;
    notes: string | null;
    archivedAt: Date | null;
    createdAt: Date;
  },
  externalRefs: ExternalRefPair[] = [],
) {
  return {
    id: company.id,
    name: company.name,
    is_internal: company.isInternal,
    notes: company.notes,
    archived_at: company.archivedAt?.toISOString() ?? null,
    created_at: company.createdAt.toISOString(),
    external_refs: externalRefs,
  };
}

export function serializeLocation(
  location: {
    id: string;
    companyId: string;
    name: string;
    address: string | null;
    archivedAt: Date | null;
  },
  externalRefs: ExternalRefPair[] = [],
) {
  return {
    id: location.id,
    company_id: location.companyId,
    name: location.name,
    address: location.address,
    archived_at: location.archivedAt?.toISOString() ?? null,
    external_refs: externalRefs,
  };
}

export function serializeDocType(
  docType: { id: string; name: string; icon: string | null; scope: string; archivedAt: Date | null },
  fieldList: FieldDefinition[] = [],
) {
  return {
    id: docType.id,
    name: docType.name,
    icon: docType.icon,
    scope: docType.scope,
    archived_at: docType.archivedAt?.toISOString() ?? null,
    fields: fieldList.map(serializeField),
  };
}

export type SerializedDocument = ReturnType<typeof serializeDocument>;

export function serializeDocument(input: {
  document: {
    id: string;
    title: string;
    companyId: string;
    locationId: string | null;
    docTypeId: string;
    fieldValues: Record<string, unknown>;
    updatedAt: Date;
    archivedAt: Date | null;
  };
  docType: { id: string; name: string; scope: string };
  location: { id: string; name: string } | null;
  fields: FieldDefinition[];
  optionLabels: Map<string, string>;
  linkedTitles?: Map<string, string>;
  externalRefs?: ExternalRefPair[];
  /** Set for webhook payloads, which must carry no vault reference. */
  redactSecrets?: boolean;
  macFormat?: MacFormat;
}) {
  return {
    id: input.document.id,
    title: input.document.title,
    company_id: input.document.companyId,
    location: input.location ? { id: input.location.id, name: input.location.name } : null,
    doc_type: {
      id: input.docType.id,
      name: input.docType.name,
      scope: input.docType.scope,
    },
    fields: serializeFieldValues(
      input.fields,
      input.document.fieldValues ?? {},
      input.optionLabels,
      input.linkedTitles ?? new Map(),
      input.redactSecrets ?? false,
      input.macFormat,
    ),
    updated_at: input.document.updatedAt.toISOString(),
    archived_at: input.document.archivedAt?.toISOString() ?? null,
    external_refs: input.externalRefs ?? [],
  };
}
