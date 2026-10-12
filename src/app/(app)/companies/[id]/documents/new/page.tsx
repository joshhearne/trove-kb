import { effectiveMacFormat } from "@/server/fields/values";
import { getMacFormat } from "@/server/services/settings";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { canEditDocuments, requireScopedUser } from "@/server/auth/session";
import { getCompany } from "@/server/services/companies";
import { listLocations } from "@/server/services/locations";
import { listDocTypes, listTemplateFields } from "@/server/services/doc-types";
import { loadOptionIndex } from "@/server/services/option-lists";
import { loadLinkTargets, loadSecretItems } from "@/server/services/documents";
import { getMessages } from "@/i18n/server";
import { DocumentForm } from "../../../../documents/document-form";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ docType?: string; location?: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { id } = await params;
  if (!canEditDocuments(user.role)) redirect(`/companies/${id}`);

  const company = await getCompany(id, scope);
  if (!company) notFound();

  const { docType: docTypeId, location: locationId } = await searchParams;
  const [docTypes, locations] = await Promise.all([listDocTypes(), listLocations(id, scope)]);

  const t = await getMessages();
  const chosen = docTypes.find((candidate) => candidate.id === docTypeId);

  if (!chosen) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.companies.newDocument}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.documents.pickDocType(company.name)}
          </p>
        </div>

        {docTypes.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.documents.noDocTypes}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {docTypes.map((candidate) => (
              <li key={candidate.id}>
                <Link
                  href={{
                    pathname: `/companies/${id}/documents/new`,
                    query: { docType: candidate.id },
                  }}
                  className="flex flex-col rounded-md border px-4 py-3 hover:bg-[var(--muted)]"
                >
                  <span className="font-medium">{candidate.name}</span>
                  <span className="text-sm text-[var(--muted-foreground)]">
                    {candidate.scope === "company"
                      ? t.documents.companyScope
                      : t.documents.locationScope}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const needsLocation = chosen.scope === "location";
  const chosenLocation = locations.find((candidate) => candidate.id === locationId);

  if (needsLocation && !chosenLocation) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.documents.newOf(chosen.name)}
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.documents.needsLocation(chosen.name)}
          </p>
        </div>

        {locations.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.documents.noLocationsForCompany(company.name)}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {locations.map((candidate) => (
              <li key={candidate.id}>
                <Link
                  href={{
                    pathname: `/companies/${id}/documents/new`,
                    query: { docType: chosen.id, location: candidate.id },
                  }}
                  className="flex rounded-md border px-4 py-3 hover:bg-[var(--muted)]"
                >
                  {candidate.name}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Link
          href={`/companies/${id}/documents/new`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {t.documents.chooseDifferentType}
        </Link>
      </div>
    );
  }

  const templateFields = await listTemplateFields(chosen.id);
  const [optionIndex, linkTargets, secrets, macFormat] = await Promise.all([
    loadOptionIndex(templateFields.flatMap((f) => (f.optionListId ? [f.optionListId] : []))),
    loadLinkTargets(templateFields, company.id, null),
    loadSecretItems(templateFields, company.id, scope),
    getMacFormat(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.documents.newOf(chosen.name)}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {company.name}
          {chosenLocation ? ` · ${chosenLocation.name}` : ""}
        </p>
      </div>

      <DocumentForm
        companyId={company.id}
        docTypeId={chosen.id}
        locationId={chosenLocation?.id ?? null}
        options={Object.fromEntries(optionIndex)}
        linkTargets={Object.fromEntries(
          [...linkTargets].map(([fieldId, targets]) => [
            fieldId,
            [...targets].map(([id, label]) => ({ id, label })),
          ]),
        )}
        secretItems={Object.fromEntries(
          [...secrets.index].map(([fieldId, items]) => [
            fieldId,
            [...items].map(([id, ref]) => ({
              id,
              label: String((ref as { label?: unknown }).label ?? id),
            })),
          ]),
        )}
        fields={templateFields.map((field) => ({
          id: field.id,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          optionListId: field.optionListId,
          linkDocTypeId: field.linkDocTypeId,
          macFormat: effectiveMacFormat(field, macFormat),
          isLocal: false,
        }))}
      />
    </div>
  );
}
