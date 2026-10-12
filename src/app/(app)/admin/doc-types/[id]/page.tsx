import { effectiveMacFormat } from "@/server/fields/values";
import { macFormatExample } from "@/lib/net/mac";
import { getMacFormat } from "@/server/services/settings";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { DocTypeScheduleForm } from "../schedule-form";
import { DocTypeForm } from "../../doc-type-form";
import { DocTypeIcon } from "@/components/doc-type-icon";
import { AddTemplateFieldForm } from "../../template-field-form";
import {
  archiveDocTypeAction,
  archiveFieldAction,
  moveTemplateFieldAction,
  unarchiveDocTypeAction,
  unarchiveFieldAction,
} from "../../actions";

export const dynamic = "force-dynamic";

export default async function DocTypePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManageDocTypes(user.role)) redirect("/companies");

  const { id } = await params;
  const docType = await getDocType(id);
  if (!docType) notFound();

  const [optionLists, allDocTypes, macFormat] = await Promise.all([
    listOptionLists(),
    listDocTypes(),
    getMacFormat(),
  ]);
  const fieldTypes = EDITABLE_FIELD_TYPES.map((value) => ({
    value,
    label: FIELD_TYPE_LABELS[value],
    usesOptionList: usesOptionList(value),
    usesLinkDocType: usesLinkDocType(value),
  }));

  const t = await getMessages();
  const active = docType.fields.filter((field) => !field.archivedAt);
  const archived = docType.fields.filter((field) => field.archivedAt);
  const order = active.map((field) => field.id).join(",");
  const listNames = new Map(optionLists.map((list) => [list.id, list.name]));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <DocTypeIcon name={docType.icon} className="size-6 shrink-0 text-[var(--muted-foreground)]" />
            {docType.name}
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {docType.scope === "company" ? t.documents.companyScope : t.documents.locationScope}
            {docType.archivedAt ? ` · ${t.common.archived}` : ""}
          </p>
        </div>
        {docType.archivedAt ? (
          <form action={unarchiveDocTypeAction}>
            <input type="hidden" name="id" value={docType.id} />
            <Button type="submit" variant="outline" size="sm">
              {t.common.restore}
            </Button>
          </form>
        ) : (
          <form action={archiveDocTypeAction}>
            <input type="hidden" name="id" value={docType.id} />
            <Button type="submit" variant="outline" size="sm">
              {t.common.archive}
            </Button>
          </form>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.admin.docTypes.details}</h2>
        <DocTypeForm
          submitLabel={t.admin.docTypes.save}
          values={{
            id: docType.id,
            name: docType.name,
            icon: docType.icon,
            scope: docType.scope,
          }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t.admin.docTypes.templateFields}
        </h2>

        {active.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.docTypes.noFields}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((field, index) => (
              <li
                key={field.id}
                className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {field.label}
                    {field.required && (
                      <span aria-hidden="true" className="text-[var(--destructive)]">
                        {" *"}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {FIELD_TYPE_LABELS[field.fieldType]}
                    {field.optionListId
                      ? ` · ${listNames.get(field.optionListId) ?? "Unknown list"}`
                      : ""}
                    {field.fieldType === "mac"
                      ? ` · ${macFormatExample(effectiveMacFormat(field, macFormat))}`
                      : ""}
                  </p>
                </div>

                <form action={moveTemplateFieldAction}>
                  <input type="hidden" name="docTypeId" value={docType.id} />
                  <input type="hidden" name="id" value={field.id} />
                  <input type="hidden" name="order" value={order} />
                  <input type="hidden" name="direction" value="up" />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={t.admin.docTypes.moveUp(field.label)}
                    disabled={index === 0}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                </form>

                <form action={moveTemplateFieldAction}>
                  <input type="hidden" name="docTypeId" value={docType.id} />
                  <input type="hidden" name="id" value={field.id} />
                  <input type="hidden" name="order" value={order} />
                  <input type="hidden" name="direction" value="down" />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon"
                    aria-label={t.admin.docTypes.moveDown(field.label)}
                    disabled={index === active.length - 1}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                </form>

                <Link
                  href={`/admin/doc-types/${docType.id}/fields/${field.id}`}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  {t.common.edit}
                </Link>

                <form action={archiveFieldAction}>
                  <input type="hidden" name="id" value={field.id} />
                  <input type="hidden" name="docTypeId" value={docType.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    {t.common.archive}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <AddTemplateFieldForm
          docTypeId={docType.id}
          docTypes={allDocTypes.map((candidate) => ({ id: candidate.id, name: candidate.name }))}
          fieldTypes={fieldTypes}
          optionLists={optionLists.map((list) => ({ id: list.id, name: list.name }))}
          instanceMacFormat={macFormat}
        />

        {archived.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              {t.admin.docTypes.archivedFields}
            </h3>
            <ul className="flex flex-col gap-2">
              {archived.map((field) => (
                <li
                  key={field.id}
                  className="flex items-center gap-3 rounded-md border border-dashed px-4 py-2"
                >
                  <span className="min-w-0 flex-1 text-sm text-[var(--muted-foreground)]">
                    {field.label} · {FIELD_TYPE_LABELS[field.fieldType]}
                  </span>
                  <form action={unarchiveFieldAction}>
                    <input type="hidden" name="id" value={field.id} />
                    <input type="hidden" name="docTypeId" value={docType.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t.common.restore}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t.admin.docTypes.archivedFieldsNote}
            </p>
          </div>
        )}
      </section>

      <DocTypeScheduleForm
        docTypeId={docType.id}
        kind={docType.scheduleKind}
        dueDays={docType.scheduleDueDays}
        intervalDays={docType.scheduleIntervalDays}
        leadDays={docType.scheduleLeadDays}
      />
    </div>
  );
}
