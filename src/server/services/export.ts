import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { docTypes, documents, locations } from "@/server/db/schema";
import { getCompanyOrThrow } from "@/server/services/companies";
import { assertInScope, type CompanyScope } from "@/server/auth/company-scope";
import { getDocumentDetail } from "@/server/services/documents";
import { serializeFieldValues, type ApiFieldValue } from "@/server/api/serializers";
import { formatDate } from "@/i18n/format";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales";

/**
 * Per-company export, JSON or markdown. A secret_ref exports as the reference
 * and its non-secret metadata; the password and TOTP are not in Trove KB to
 * export (CLAUDE.md).
 */

export type ExportedDocument = {
  id: string;
  title: string;
  doc_type: string;
  location: string | null;
  updated_at: string;
  fields: ApiFieldValue[];
};

export type CompanyExport = {
  exported_at: string;
  company: {
    id: string;
    name: string;
    is_internal: boolean;
    notes: string | null;
  };
  locations: { id: string; name: string; address: string | null }[];
  documents: ExportedDocument[];
  note: string;
};

export async function buildCompanyExport(
  companyId: string,
  scope: CompanyScope,
): Promise<CompanyExport> {
  const company = await getCompanyOrThrow(companyId, scope);

  const [companyLocations, documentRows] = await Promise.all([
    db
      .select({ id: locations.id, name: locations.name, address: locations.address })
      .from(locations)
      .where(and(eq(locations.companyId, companyId), isNull(locations.archivedAt)))
      .orderBy(asc(locations.name)),
    db
      .select({ id: documents.id, docTypeName: docTypes.name })
      .from(documents)
      .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
      .where(and(eq(documents.companyId, companyId), isNull(documents.archivedAt)))
      .orderBy(asc(docTypes.name), asc(documents.title)),
  ]);

  const exported: ExportedDocument[] = [];

  for (const row of documentRows) {
    const detail = await getDocumentDetail(row.id, scope);
    if (!detail) continue;

    exported.push({
      id: detail.document.id,
      title: detail.document.title,
      doc_type: row.docTypeName,
      location: detail.location?.name ?? null,
      updated_at: detail.document.updatedAt.toISOString(),
      fields: serializeFieldValues(
        detail.fields,
        detail.document.fieldValues ?? {},
        detail.optionLabels,
        detail.linkedTitles,
        false,
        detail.macFormat,
      ),
    });
  }

  return {
    exported_at: new Date().toISOString(),
    company: {
      id: company.id,
      name: company.name,
      is_internal: company.isInternal,
      notes: company.notes,
    },
    locations: companyLocations,
    documents: exported,
    note: "Secret fields export as a vault reference. Passwords and TOTP seeds are never stored by Trove KB.",
  };
}

/** Doc types a company has documents of, in the order the export lists them. */
export async function listExportableDocTypes(
  companyId: string,
  scope: CompanyScope,
): Promise<string[]> {
  assertInScope(scope, companyId);
  const rows = await db
    .selectDistinct({ name: docTypes.name })
    .from(documents)
    .innerJoin(docTypes, eq(docTypes.id, documents.docTypeId))
    .where(and(eq(documents.companyId, companyId), isNull(documents.archivedAt)))
    .orderBy(asc(docTypes.name));
  return rows.map((row) => row.name);
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function fieldToMarkdown(field: ApiFieldValue, locale: Locale): string {
  if (field.value === null || field.value === undefined) return "—";

  if (field.type === "secret_ref") {
    const ref = field.value as { label?: string; username?: string | null };
    const who = ref.username ? ` (${ref.username})` : "";
    return `vault item: ${ref.label ?? "unnamed"}${who}`;
  }

  if (Array.isArray(field.resolved)) return field.resolved.join(", ");
  if (field.type === "markdown") return String(field.value);
  if (field.type === "richtext") return "(rich text, see the JSON export)";
  if (field.type === "date") return formatDate(String(field.value), locale);
  if (typeof field.resolved === "string" && field.resolved !== "") return field.resolved;
  return String(field.value);
}

/** A readable document per company, grouped by doc type. */
export function toMarkdown(data: CompanyExport, locale: Locale = DEFAULT_LOCALE): string {
  const lines: string[] = [];

  lines.push(`# ${data.company.name}`, "");
  if (data.company.is_internal) lines.push("_Internal organization._", "");
  if (data.company.notes) lines.push(data.company.notes, "");

  lines.push(`Exported ${data.exported_at}.`, "", data.note, "");

  lines.push("## Locations", "");
  if (data.locations.length === 0) {
    lines.push("None recorded.", "");
  } else {
    lines.push("| Location | Address |", "| --- | --- |");
    for (const location of data.locations) {
      lines.push(`| ${escapeTableCell(location.name)} | ${escapeTableCell(location.address ?? "—")} |`);
    }
    lines.push("");
  }

  lines.push("## Documents", "");
  if (data.documents.length === 0) {
    lines.push("None recorded.", "");
    return lines.join("\n");
  }

  let currentType = "";
  for (const document of data.documents) {
    if (document.doc_type !== currentType) {
      currentType = document.doc_type;
      lines.push(`### ${currentType}`, "");
    }

    lines.push(`#### ${document.title}`, "");
    if (document.location) lines.push(`Location: ${document.location}`, "");

    const filled = document.fields.filter((field) => field.value !== null);
    if (filled.length === 0) {
      lines.push("_No values recorded._", "");
      continue;
    }

    for (const field of filled) {
      const rendered = fieldToMarkdown(field, locale);
      if (field.type === "markdown" && rendered.includes("\n")) {
        lines.push(`**${field.label}**`, "", rendered, "");
      } else {
        lines.push(`- **${field.label}:** ${rendered.replace(/\n+/g, " ")}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** A filename that is safe on every platform. */
export function exportFilename(companyName: string, extension: "json" | "md"): string {
  const slug =
    companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "company";
  const stamp = new Date().toISOString().slice(0, 10);
  return `trove-kb-${slug}-${stamp}.${extension}`;
}
