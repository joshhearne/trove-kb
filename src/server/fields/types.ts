import { FIELD_TYPES } from "@/server/db/schema";

export type FieldType = (typeof FIELD_TYPES)[number];

/** Every field type is editable now. Kept so a future type can opt out. */
export const UNSUPPORTED_FIELD_TYPES = [] as const satisfies FieldType[];

export type EditableFieldType = FieldType;

export const EDITABLE_FIELD_TYPES = FIELD_TYPES.filter(
  (type): type is EditableFieldType =>
    !(UNSUPPORTED_FIELD_TYPES as readonly string[]).includes(type),
);

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  markdown: "Markdown",
  richtext: "Rich text",
  number: "Number",
  date: "Date",
  url: "URL",
  ip: "IP address",
  ip_list: "IP address list",
  network: "Network (CIDR)",
  ip_range: "IP range",
  mac: "MAC address",
  vlan: "VLAN ID",
  hostname: "Hostname",
  port: "Port",
  port_range: "Port range",
  boolean: "Yes / no",
  dropdown: "Dropdown",
  multi_dropdown: "Multi-select dropdown",
  doc_link: "Link to document",
  secret_ref: "Secret",
};

/** Dropdown types are the ones that need an option list attached. */
export function usesOptionList(type: FieldType): boolean {
  return type === "dropdown" || type === "multi_dropdown";
}

/** doc_link is the one type that points at another doc type. */
export function usesLinkDocType(type: FieldType): boolean {
  return type === "doc_link";
}

/** secret_ref is brokered by the vault provider rather than typed in. */
export function usesVault(type: FieldType): boolean {
  return type === "secret_ref";
}

/** mac is the one type that carries a format of its own. */
export function usesMacFormat(type: FieldType): boolean {
  return type === "mac";
}

export function isEditableType(type: FieldType): boolean {
  return !(UNSUPPORTED_FIELD_TYPES as readonly string[]).includes(type);
}

/** The shape every value function needs about the field it is handling. */
export type FieldDefinition = {
  id: string;
  label: string;
  fieldType: FieldType;
  optionListId: string | null;
  /** doc_link only: the doc type this field points at, when constrained. */
  linkDocTypeId: string | null;
  required: boolean;
  sortOrder: number;
  /** mac only: the field's own format; null follows the instance setting. */
  macFormat: string | null;
  archivedAt: Date | null;
  docTypeId: string | null;
  documentId: string | null;
};
