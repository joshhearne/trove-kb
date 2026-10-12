import { getMacFormat } from "@/server/services/settings";
import { notFound, redirect } from "next/navigation";
import { canManageDocTypes, requireUser } from "@/server/auth/session";
import { getDocType, listDocTypes } from "@/server/services/doc-types";
import { listOptionLists } from "@/server/services/option-lists";
import {
  EDITABLE_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  usesLinkDocType,
  usesOptionList,
} from "@/server/fields/types";
import { getMessages } from "@/i18n/server";
import { EditTemplateFieldForm } from "../../../../template-field-form";

export const dynamic = "force-dynamic";

export default async function EditTemplateFieldPage({
  params,
}: {
  params: Promise<{ id: string; fieldId: string }>;
}) {
  const user = await requireUser();
  if (!canManageDocTypes(user.role)) redirect("/companies");

  const { id, fieldId } = await params;
  const docType = await getDocType(id);
  if (!docType) notFound();

  const field = docType.fields.find((candidate) => candidate.id === fieldId);
  if (!field) notFound();

  const [optionLists, allDocTypes, macFormat] = await Promise.all([
    listOptionLists(),
    listDocTypes(),
    getMacFormat(),
  ]);
  const t = await getMessages();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
        {t.companies.editHeading(field.label)}
      </h1>
        <p className="text-sm text-[var(--muted-foreground)]">{docType.name}</p>
      </div>
      <EditTemplateFieldForm
        docTypeId={docType.id}
        docTypes={allDocTypes.map((candidate) => ({ id: candidate.id, name: candidate.name }))}
        field={{
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          optionListId: field.optionListId,
          linkDocTypeId: field.linkDocTypeId,
          macFormat: field.macFormat,
          required: field.required,
        }}
        instanceMacFormat={macFormat}
        fieldTypes={EDITABLE_FIELD_TYPES.map((value) => ({
          value,
          label: FIELD_TYPE_LABELS[value],
          usesOptionList: usesOptionList(value),
          usesLinkDocType: usesLinkDocType(value),
        }))}
        optionLists={optionLists.map((list) => ({ id: list.id, name: list.name }))}
      />
    </div>
  );
}
