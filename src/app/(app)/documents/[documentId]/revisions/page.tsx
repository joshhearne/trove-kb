import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { FieldValue } from "@/components/fields/field-value";
import { requireScopedUser } from "@/server/auth/session";
import { getDocumentDetail, listRevisions } from "@/server/services/documents";
import { getCompanyBranding } from "@/server/services/branding";
import { BrandAccent } from "@/components/brand";
import { renderFieldValue } from "@/server/fields/render";
import { formatDateTime } from "@/i18n/format";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function RevisionsPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { scope } = await requireScopedUser();
  const { documentId } = await params;

  const detail = await getDocumentDetail(documentId, scope);
  if (!detail) notFound();

  const revisions = await listRevisions(documentId, scope);
  const branding = await getCompanyBranding(detail.document.companyId, scope);
  const { locale, messages: t } = await getI18n();

  return (
    <BrandAccent brand={branding} className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.documents.historyHeading}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">{detail.document.title}</p>
        </div>
        <Link
          href={`/documents/${documentId}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {t.documents.backToDocument}
        </Link>
      </div>

      {revisions.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t.documents.noRevisions}</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {revisions.map((revision, index) => (
            <li key={revision.id} className="rounded-md border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                <span className="text-sm font-medium">{revision.title}</span>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {formatDateTime(revision.createdAt, locale)}
                  {index === 0 ? ` · ${t.documents.current}` : ""}
                </span>
              </div>
              <dl className="flex flex-col divide-y">
                {detail.fields.map((field) => (
                  <div
                    key={field.id}
                    className="grid gap-1 px-4 py-2 sm:grid-cols-[14rem_1fr] sm:gap-4"
                  >
                    <dt className="text-sm text-[var(--muted-foreground)]">{field.label}</dt>
                    <dd className="min-w-0">
                      <FieldValue
                        value={renderFieldValue(
                          field,
                          revision.fieldValues?.[field.id] ?? null,
                          detail.optionLabels,
                          detail.linkedTitles,
                          locale,
                          detail.macFormat,
                        )}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </BrandAccent>
  );
}
