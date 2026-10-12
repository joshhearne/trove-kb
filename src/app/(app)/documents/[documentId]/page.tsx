import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldValue } from "@/components/fields/field-value";
import { SecretField } from "@/components/fields/secret-field";
import { canEditDocuments, requireScopedUser } from "@/server/auth/session";
import { getCompany } from "@/server/services/companies";
import { getDocumentDetail, listBacklinks } from "@/server/services/documents";
import { getCompanyBranding } from "@/server/services/branding";
import { BrandAccent, BrandLogo } from "@/components/brand";
import { DocTypeIcon } from "@/components/doc-type-icon";
import { renderFieldValue } from "@/server/fields/render";
import { formatDateTime } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { formatBytes, listAttachments } from "@/server/services/attachments";
import { getDomainCheckState } from "@/server/services/domain-checks";
import { DomainPanel } from "../domain-panel";
import { getRackView } from "@/server/services/racks";
import { getSchedule } from "@/server/services/schedules";
import { SchedulePanel } from "../schedule-panel";
import { listCompanyDocuments } from "@/server/services/documents";
import { listDocTypes } from "@/server/services/doc-types";
import { RackPanel } from "../rack-panel";
import { env } from "@/lib/env";
import { ACCEPTED_UPLOAD_TYPES } from "@/server/uploads/accept";
import { AttachmentUpload } from "../attachment-upload";
import {
  archiveDocumentAction,
  removeAttachmentAction,
  unarchiveDocumentAction,
} from "../actions";

export const dynamic = "force-dynamic";

/** What a field currently holds, as stored. */
function valueOf(
  detail: { document: { fieldValues: Record<string, unknown> | null } },
  fieldId: string | undefined,
): string | null {
  if (!fieldId) return null;
  const value = detail.document.fieldValues?.[fieldId];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The same, but as a person reads it: a dropdown stores an option id, and a
 * suggestion arrives as the name on the option.
 */
function labelOf(
  detail: {
    document: { fieldValues: Record<string, unknown> | null };
    optionLabels: Map<string, string>;
  },
  fieldId: string | undefined,
): string | null {
  const value = valueOf(detail, fieldId);
  if (!value) return null;
  return detail.optionLabels.get(value) ?? value;
}

/** Whether what the record holds in this field is an option id from a shared list. */
function isOption(
  detail: {
    document: { fieldValues: Record<string, unknown> | null };
    optionLabels: Map<string, string>;
  },
  fieldId: string | undefined,
): boolean {
  const value = valueOf(detail, fieldId);
  return value !== null && detail.optionLabels.has(value);
}

/** Deep link into the web vault, for link mode and degraded fallbacks. */
function webVaultItemUrl(
  base: string | null | undefined,
  itemId: string,
): string | null {
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/#/vault?itemId=${encodeURIComponent(itemId)}`;
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { documentId } = await params;

  const detail = await getDocumentDetail(documentId, scope);
  if (!detail) notFound();

  const [company, backlinks, files] = await Promise.all([
    getCompany(detail.document.companyId, scope),
    listBacklinks(documentId, scope),
    listAttachments(documentId, scope),
  ]);
  if (!company) notFound();

  const editor = canEditDocuments(user.role);
  const { locale, messages: t } = await getI18n();

  const branding = await getCompanyBranding(company.id, scope);
  const domainState = await getDomainCheckState(documentId, scope);
  const schedule = await getSchedule(documentId, scope);

  /*
   * A rack elevation belongs to documents of a doc type that says it is a
   * rack. The view is null until somebody sets the size, which is what the
   * panel's own form does.
   */
  const isRack = detail.docType.isRack;
  const rackView = isRack ? await getRackView(documentId, scope) : null;
  const [mountable, allDocTypes] = isRack
    ? await Promise.all([
        listCompanyDocuments(company.id, scope),
        listDocTypes(),
      ])
    : [[], []];

  return (
    <BrandAccent brand={branding} className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <BrandLogo branding={branding} className="h-5 max-w-24" />
            <Link href={`/companies/${company.id}`} className="hover:underline">
              {company.name}
            </Link>
            {detail.location ? ` · ${detail.location.name}` : ""} ·{" "}
            <DocTypeIcon name={detail.docType.icon} className="size-4 shrink-0" />
            {detail.docType.name}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {detail.document.title}
            </h1>
            {detail.document.archivedAt && (
              <span className="rounded-full border px-2 py-0.5 text-xs text-[var(--muted-foreground)]">
                {t.common.archived}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.documents.updated(
              formatDateTime(detail.document.updatedAt, locale),
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/documents/${detail.document.id}/revisions`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t.documents.history}
          </Link>
          {editor && !detail.document.archivedAt && (
            <Link
              href={`/documents/${detail.document.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t.common.edit}
            </Link>
          )}
          {editor &&
            (detail.document.archivedAt ? (
              <form action={unarchiveDocumentAction}>
                <input
                  type="hidden"
                  name="documentId"
                  value={detail.document.id}
                />
                <input type="hidden" name="companyId" value={company.id} />
                <Button type="submit" variant="outline" size="sm">
                  {t.common.restore}
                </Button>
              </form>
            ) : (
              <form action={archiveDocumentAction}>
                <input
                  type="hidden"
                  name="documentId"
                  value={detail.document.id}
                />
                <input type="hidden" name="companyId" value={company.id} />
                <Button type="submit" variant="outline" size="sm">
                  {t.common.archive}
                </Button>
              </form>
            ))}
        </div>
      </div>

      {detail.fields.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.documents.noFields}
        </p>
      ) : (
        <dl className="flex flex-col divide-y rounded-md border">
          {detail.fields.map((field) => (
            <div
              key={field.id}
              className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4"
            >
              <dt className="text-sm font-medium text-[var(--muted-foreground)]">
                {field.label}
              </dt>
              <dd className="min-w-0">
                {(() => {
                  const rendered = renderFieldValue(
                    field,
                    detail.document.fieldValues?.[field.id] ?? null,
                    detail.optionLabels,
                    detail.linkedTitles,
                    locale,
                    detail.macFormat,
                  );

                  if (rendered.kind !== "secret")
                    return <FieldValue value={rendered} />;

                  return (
                    <SecretField
                      documentId={detail.document.id}
                      fieldId={field.id}
                      itemId={rendered.itemId}
                      label={rendered.label}
                      username={rendered.username}
                      uri={rendered.uri}
                      webVaultUrl={webVaultItemUrl(
                        detail.vault?.webVaultUrl,
                        rendered.itemId,
                      )}
                      canReveal={user.canRevealSecrets}
                      brokering={detail.vault?.brokering ?? false}
                      vaultStatus={detail.vault?.status ?? "unreachable"}
                    />
                  );
                })()}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <SchedulePanel
        documentId={documentId}
        schedule={schedule}
        editor={editor && !detail.document.archivedAt}
      />

      {isRack && rackView && (
        <RackPanel
          view={rackView}
          editor={editor && !detail.document.archivedAt}
          mountable={mountable
            .filter((candidate) => candidate.id !== documentId)
            .map((candidate) => ({ id: candidate.id, title: candidate.title }))}
          docTypes={allDocTypes.map((type) => ({
            id: type.id,
            name: type.name,
          }))}
        />
      )}

      {isRack && !rackView && editor && (
        <RackPanel
          view={{
            documentId,
            name: detail.document.title,
            companyId: company.id,
            totalU: 42,
            hasRear: false,
            numbering: "bottom_up",
            mounts: [],
            legend: [],
            warnings: [],
            version: "new",
          }}
          editor
          mountable={[]}
          docTypes={allDocTypes.map((type) => ({
            id: type.id,
            name: type.name,
          }))}
        />
      )}

      {domainState.targets.domain && (
        <DomainPanel
          documentId={detail.document.id}
          state={domainState}
          editor={editor && !detail.document.archivedAt}
          current={{
            expiry: valueOf(detail, domainState.targets.expiry),
            registrar: labelOf(detail, domainState.targets.registrar),
            dnsHost: labelOf(detail, domainState.targets.dns_host),
            options: {
              expiry: isOption(detail, domainState.targets.expiry),
              registrar: isOption(detail, domainState.targets.registrar),
              dnsHost: isOption(detail, domainState.targets.dns_host),
            },
          }}
          checkedAt={domainState.checkedAt?.toISOString() ?? null}
          nextRunAt={domainState.automation.nextRunAt?.toISOString() ?? null}
        />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t.documents.attachments}
        </h2>

        {files.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.documents.noAttachments}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3"
              >
                <Paperclip
                  className="size-4 shrink-0 text-[var(--muted-foreground)]"
                  aria-hidden
                />
                <a
                  href={`/api/attachments/${file.id}`}
                  className="min-w-0 flex-1 truncate font-medium hover:underline"
                >
                  {file.filename}
                </a>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {formatBytes(file.sizeBytes, locale)} ·{" "}
                  {formatDateTime(file.createdAt, locale)}
                </span>
                {editor && (
                  <form action={removeAttachmentAction}>
                    <input type="hidden" name="attachmentId" value={file.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t.common.remove}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {editor && !detail.document.archivedAt && (
          <AttachmentUpload
            documentId={detail.document.id}
            maxMb={env.MAX_UPLOAD_MB}
            accept={ACCEPTED_UPLOAD_TYPES}
          />
        )}
      </section>

      {backlinks.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {t.documents.linkedFrom}
          </h2>
          <ul className="flex flex-col gap-2">
            {backlinks.map((backlink) => (
              <li
                key={`${backlink.documentId}-${backlink.fieldLabel}`}
                className="flex flex-wrap items-center gap-2 rounded-md border px-4 py-3"
              >
                <Link
                  href={`/documents/${backlink.documentId}`}
                  className="font-medium hover:underline"
                >
                  {backlink.title}
                </Link>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {backlink.docTypeName} · {backlink.fieldLabel}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </BrandAccent>
  );
}
