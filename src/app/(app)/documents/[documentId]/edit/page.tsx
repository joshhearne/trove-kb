import { effectiveMacFormat } from "@/server/fields/values";
import { notFound, redirect } from "next/navigation";
import {
  canEditDocuments,
  canManageDocTypes,
  requireScopedUser,
} from "@/server/auth/session";
import { getCompany } from "@/server/services/companies";
import { getDocumentDetail } from "@/server/services/documents";
import { getCompanyBranding } from "@/server/services/branding";
import { DocTypeIcon } from "@/components/doc-type-icon";
import { BrandAccent } from "@/components/brand";
import { listOptionLists } from "@/server/services/option-lists";
import {
  EDITABLE_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  usesLinkDocType,
  usesOptionList,
} from "@/server/fields/types";
import { listDocTypes } from "@/server/services/doc-types";
import { getMessages } from "@/i18n/server";
import { DocumentEditor } from "./document-editor";

export const dynamic = "force-dynamic";

export default async function EditDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { documentId } = await params;
  if (!canEditDocuments(user.role)) redirect(`/documents/${documentId}`);

  const detail = await getDocumentDetail(documentId, scope);
  if (!detail) notFound();

  const company = await getCompany(detail.document.companyId, scope);
  if (!company) notFound();
  const branding = await getCompanyBranding(company.id, scope);

  const [optionLists, docTypes] = await Promise.all([listOptionLists(), listDocTypes()]);
  const t = await getMessages();

  return (
    <BrandAccent brand={branding} className="flex flex-col gap-6">
      <div>
        <p className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
          {company.name}
          {detail.location ? ` · ${detail.location.name}` : ""} ·{" "}
          <DocTypeIcon name={detail.docType.icon} className="size-4 shrink-0" />
          {detail.docType.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t.documents.editHeading(detail.document.title)}
        </h1>
      </div>

      <DocumentEditor
        documentId={detail.document.id}
        docTypeId={detail.docType.id}
        docTypeName={detail.docType.name}
        initialTitle={detail.document.title}
        initialValues={detail.document.fieldValues ?? {}}
        initialOptions={Object.fromEntries(detail.optionIndex)}
        canManageTemplate={canManageDocTypes(user.role)}
        optionLists={optionLists.map((list) => ({ id: list.id, name: list.name }))}
        docTypeChoices={docTypes.map((docType) => ({ id: docType.id, name: docType.name }))}
        linkTargets={Object.fromEntries(
          [...detail.linkTargets].map(([fieldId, targets]) => [
            fieldId,
            [...targets].map(([id, label]) => ({ id, label })),
          ]),
        )}
        secretItems={Object.fromEntries(
          [...detail.secretItems].map(([fieldId, items]) => [
            fieldId,
            [...items].map(([id, ref]) => ({
              id,
              label: String((ref as { label?: unknown }).label ?? id),
            })),
          ]),
        )}
        fieldTypes={EDITABLE_FIELD_TYPES.map((value) => ({
          value,
          label: FIELD_TYPE_LABELS[value],
          usesOptionList: usesOptionList(value),
          usesLinkDocType: usesLinkDocType(value),
        }))}
        initialFields={detail.fields.map((field) => ({
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          optionListId: field.optionListId,
          linkDocTypeId: field.linkDocTypeId,
          macFormat: effectiveMacFormat(field, detail.macFormat),
          isLocal: field.documentId !== null,
        }))}
        instanceMacFormat={detail.macFormat}
      />
    </BrandAccent>
  );
}
