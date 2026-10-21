import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyBlock } from "@/components/ui/copy-block";
import { env } from "@/lib/env";
import { isWorkers } from "@/lib/runtime";
import { requireUser } from "@/server/auth/session";
import { listAllCollections, listCollectionCompanyIds } from "@/server/services/kb";
import { listCompanies } from "@/server/services/companies";
import { ALL_COMPANIES } from "@/server/auth/company-scope";
import { getKbPublicSettings } from "@/server/services/settings";
import { listImports } from "@/server/services/kb-import";
import { listConnectors } from "@/server/services/kb-connectors";
import { GRANT_LEVELS, listKeyGrants, listUserGrants } from "@/server/services/kb-grants";
import { listCategoryVisibility, listHideRules } from "@/server/services/kb-visibility";
import { formatDateTime, plural } from "@/i18n/format";
import { getI18n } from "@/i18n/server";
import { CollectionForm, ConnectorForm } from "../../kb-forms";
import { KbImport } from "../../kb-import";
import { CategoryVisibilityEditor, HideRules } from "../../kb-visibility";
import {
  archiveConnectorAction,
  runConnectorAction,
  setCollectionArchivedAction,
  setConnectorEnabledAction,
  setGrantAction,
  setUserGrantAction,
} from "../../kb-actions";
import { Select } from "@/components/ui/select";
import { isAdministrator } from "@/server/auth/roles";

export const dynamic = "force-dynamic";

export default async function KbCollectionAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const collection = (await listAllCollections()).find((row) => row.id === id);
  if (!collection) notFound();

  const [
    imports,
    connectors,
    keys,
    companies,
    companyIds,
    publicSite,
    hideRules,
    categoryVisibility,
    people,
    { locale, messages: t },
  ] = await Promise.all([
    listImports(id, 10),
    listConnectors(id),
    listKeyGrants(id),
    listCompanies(ALL_COMPANIES),
    listCollectionCompanyIds(id),
    getKbPublicSettings(),
    listHideRules(id),
    listCategoryVisibility(id),
    listUserGrants(id),
    getI18n(),
  ]);
  const available = !isWorkers();

  const endpoint = `${env.APP_URL.replace(/\/+$/, "")}/api/mcp`;
  // One line: a command broken across two loses its second half to whatever
  // pastes it, and what is left connects with no key at all.
  const connect = `claude mcp add --transport http trove-kb ${endpoint} --header "X-Auth-Token: YOUR_API_KEY"`;
  const instruct = [
    "## Knowledge base",
    `This application's user documentation lives in Trove KB, in the collection "${collection.name}"`,
    `(collection_id ${collection.id}), reached through the \`trove-kb\` MCP server.`,
    "",
    "After any change that alters what a user sees or does — a screen, a field, a",
    "workflow, a permission, a setting, an error message — update the knowledge base in",
    "the same piece of work, without being asked:",
    "",
    "1. Call `list_kb_articles` to see what exists.",
    "2. Rewrite each article the change makes wrong, and write new ones for new features,",
    "   with `upsert_kb_article`. Reuse the article's `external_id`; send the whole article.",
    "3. Call `archive_kb_article` for anything that describes something removed.",
    "",
    "Write for the people who use the application, not for developers. Never put",
    "credentials, keys, internal hostnames, or infrastructure details in an article.",
  ].join("\n");

  const statusLabel = (status: string) =>
    t.admin.kb.status[status as keyof typeof t.admin.kb.status] ?? status;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/kb"
          className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t.kb.backTo(t.admin.kb.title)}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="min-w-0 flex-1 text-lg font-semibold tracking-tight break-words">
            {collection.name}
          </h2>
          <Link href={`/kb/${collection.id}`} className="text-sm underline">
            {t.admin.kb.view}
          </Link>
        </div>
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.admin.kb.summary(
            plural(collection.articleCount, t.units.article, t.units.articles, locale),
            collection.unextractedCount,
          )}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t.admin.kb.importHeading}</h3>
        {available ? (
          <KbImport collectionId={collection.id} maxMb={env.KB_IMPORT_MAX_MB} />
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.unavailable}</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t.admin.kb.history}</h3>
        {imports.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.noHistory}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {imports.map((run) => (
              <li key={run.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <p className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{statusLabel(run.status)}</span>
                  <span className="text-[var(--muted-foreground)]">
                    {run.source === "connector" ? t.admin.kb.fromConnector : t.admin.kb.fromUpload}
                    {" · "}
                    {formatDateTime(run.startedAt, locale)}
                  </span>
                </p>
                {run.filename && (
                  <p className="text-xs break-all text-[var(--muted-foreground)]">{run.filename}</p>
                )}
                <p className="tabular-nums">
                  {t.admin.kb.counts(run.added, run.updated, run.skipped, run.failed)}
                </p>
                {run.error && <p className="text-[var(--destructive)]">{run.error}</p>}
                {run.failures.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-xs underline">
                      {t.admin.kb.failures}
                    </summary>
                    <ul className="mt-1 flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
                      {run.failures.map((failure) => (
                        <li key={failure.path} className="break-words">
                          <code>{failure.path}</code> — {failure.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">{t.admin.kb.people}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.peopleHint}</p>
        </div>
        {people.filter((person) => !isAdministrator(person.role)).length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.noPeople}</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y rounded-md border">
              {people
                .filter((person) => !isAdministrator(person.role))
                .map((person) => (
                  <li key={person.userId}>
                    <form action={setUserGrantAction} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <input type="hidden" name="collectionId" value={collection.id} />
                      <input type="hidden" name="userId" value={person.userId} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium break-words">{person.name}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">{person.email}</p>
                      </div>
                      <Select
                        name="level"
                        defaultValue={person.level}
                        aria-label={t.admin.kb.peopleLevelFor(person.name)}
                        className="h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      >
                        {GRANT_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {t.admin.kb.levels[level]}
                          </option>
                        ))}
                      </Select>
                      <Button type="submit" variant="outline" size="sm">
                        {t.admin.kb.saveLevel}
                      </Button>
                    </form>
                  </li>
                ))}
            </ul>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t.admin.kb.peopleWriters(people.filter((person) => person.level === "write").length)}
            </p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">{t.admin.kb.keys}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.keysHint}</p>
        </div>

        {!collection.mcpEnabled && (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.keysMcpOff}</p>
        )}
        {keys.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.noKeys}</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y rounded-md border">
              {keys.map((key) => (
                <li key={key.apiKeyId}>
                  <form
                    action={setGrantAction}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <input type="hidden" name="collectionId" value={collection.id} />
                    <input type="hidden" name="apiKeyId" value={key.apiKeyId} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{key.name}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        <code>{key.prefix}…</code> ·{" "}
                        {key.lastUsedAt
                          ? t.admin.apiKeys.lastUsed(formatDateTime(key.lastUsedAt, locale))
                          : t.admin.apiKeys.neverUsed}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="reactions"
                        defaultChecked={key.reactions}
                        aria-label={t.admin.kb.accessReactionsFor(key.name)}
                        className="size-4 accent-[var(--primary)]"
                      />
                      {t.admin.kb.reactionsShort}
                    </label>
                    <Select
                      name="level"
                      defaultValue={key.level}
                      aria-label={t.admin.kb.levelFor(key.name)}
                      className="h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      {GRANT_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {t.admin.kb.levels[level]}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" variant="outline" size="sm">
                      {t.admin.kb.saveLevel}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t.admin.kb.writers(keys.filter((key) => key.level === "write").length)}
            </p>

            <details className="rounded-md border px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium">{t.admin.kb.setup}</summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.setupHint}</p>
                <p className="text-sm font-medium">{t.admin.kb.setupConnect}</p>
                <CopyBlock value={connect} label={t.admin.kb.setupConnect} />
                <p className="text-sm font-medium">{t.admin.kb.setupInstruct}</p>
                <CopyBlock value={instruct} label={t.admin.kb.setupInstruct} wrap />
              </div>
            </details>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">{t.admin.kb.connectors}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.connectorsHint}</p>
        </div>

        {!available ? (
          <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.unavailable}</p>
        ) : (
          <>
            {connectors.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">{t.admin.kb.noConnectors}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {connectors.map((connector) => (
                  <li
                    key={connector.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-all">{connector.url}</p>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {[
                          connector.kind === "sitemap"
                            ? t.admin.kb.kindSitemap
                            : connector.kind === "helpcenter"
                              ? t.admin.kb.kindHelpCenter
                              : t.admin.kb.kindPrefix,
                          t.admin.kb.every(connector.intervalHours),
                          connector.lastRunAt
                            ? t.admin.kb.lastRun(formatDateTime(connector.lastRunAt, locale))
                            : t.admin.kb.neverRun,
                          !connector.enabled
                            ? t.admin.kb.disabled
                            : connector.nextRunAt
                              ? t.admin.kb.nextRun(formatDateTime(connector.nextRunAt, locale))
                              : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>

                    <form action={runConnectorAction}>
                      <input type="hidden" name="id" value={connector.id} />
                      <input type="hidden" name="collectionId" value={collection.id} />
                      <Button type="submit" variant="outline" size="sm">
                        {t.admin.kb.runNow}
                      </Button>
                    </form>
                    <form action={setConnectorEnabledAction}>
                      <input type="hidden" name="id" value={connector.id} />
                      <input type="hidden" name="collectionId" value={collection.id} />
                      {!connector.enabled && <input type="hidden" name="enabled" value="on" />}
                      <Button type="submit" variant="outline" size="sm">
                        {connector.enabled ? t.admin.kb.disable : t.admin.kb.enable}
                      </Button>
                    </form>
                    <form action={archiveConnectorAction}>
                      <input type="hidden" name="id" value={connector.id} />
                      <input type="hidden" name="collectionId" value={collection.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {t.common.archive}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <h4 className="text-sm font-medium">{t.admin.kb.addConnector}</h4>
            <ConnectorForm collectionId={collection.id} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-5">
        <div>
          <h3 className="text-sm font-medium">{t.admin.kb.visibility.heading}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">
            {collection.publicAccess ? t.admin.kb.visibility.hint : t.admin.kb.visibility.offHint}
          </p>
        </div>
        <HideRules collectionId={collection.id} rules={hideRules} />
        <CategoryVisibilityEditor collectionId={collection.id} categories={categoryVisibility} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t.admin.kb.settings}</h3>
        <CollectionForm
          publicSiteOn={publicSite.mode !== "off"}
          companies={companies.map((company) => ({ id: company.id, name: company.name }))}
          collection={{
            id: collection.id,
            name: collection.name,
            description: collection.description,
            siteUrl: collection.siteUrlSet,
            mcpEnabled: collection.mcpEnabled,
            publicAccess: collection.publicAccess,
            companyIds,
          }}
        />

        <form action={setCollectionArchivedAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={collection.id} />
          {!collection.archivedAt && <input type="hidden" name="archived" value="on" />}
          <p className="text-xs text-[var(--muted-foreground)]">{t.admin.kb.archiveHint}</p>
          <div>
            <Button type="submit" variant="outline" size="sm">
              {collection.archivedAt ? t.common.restore : t.common.archive}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
