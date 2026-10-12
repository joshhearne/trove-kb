import { requireRecentMfa, requireUser } from "@/server/auth/session";
import {
  getDefaultLocale,
  getDomainCheckPolicy,
  getMacFormat,
} from "@/server/services/settings";
import { env } from "@/lib/env";
import { getMessages } from "@/i18n/server";
import { LOCALE_NAMES, LOCALES } from "@/i18n/locales";
import Link from "next/link";
import type { Route } from "next";
import { DefaultLocaleForm, DomainPolicyForm, MacFormatForm } from "../settings-forms";

export const dynamic = "force-dynamic";

/**
 * What is set once for the whole installation. The language a new reader gets
 * is chosen here; everything else on this page is configuration the operator
 * set in the environment, shown so nobody has to read a compose file to find
 * out how their own instance is running.
 */
export default async function SettingsPage() {
  await requireRecentMfa(await requireUser(), "/admin/settings");
  const [chosen, t, domainPolicy, macFormat] = await Promise.all([
    getDefaultLocale(),
    getMessages(),
    getDomainCheckPolicy(),
    getMacFormat(),
  ]);

  const configuration: [string, string][] = [
    [t.admin.settings.storage, env.STORAGE_DRIVER],
    [t.admin.settings.uploadLimit, `${env.MAX_UPLOAD_MB} MB`],
    [t.admin.settings.vaultMode, env.VAULT_MODE],
    [
      t.admin.settings.sso,
      env.OIDC_ISSUER
        ? t.admin.settings.configured
        : t.admin.settings.notConfigured,
    ],
    [t.admin.settings.appUrl, env.APP_URL],
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t.admin.settings.language}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.settings.languageHint}
          </p>
        </div>

        <DefaultLocaleForm
          chosen={chosen}
          fallback={env.APP_LOCALE}
          locales={LOCALES.map((locale) => ({
            value: locale,
            label: LOCALE_NAMES[locale],
          }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t.admin.settings.publicKb}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.settings.publicMoved}{" "}
            <Link href={"/admin/portal" as Route} className="underline">
              {t.nav.portal}
            </Link>
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t.admin.settings.network}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.settings.networkHint}
          </p>
        </div>

        <MacFormatForm current={macFormat} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t.admin.settings.domainChecks}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.settings.domainChecksHint}
          </p>
        </div>

        <DomainPolicyForm policy={domainPolicy} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t.admin.settings.configuration}
          </h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.admin.settings.configurationHint}
          </p>
        </div>

        <dl className="flex flex-col divide-y rounded-md border">
          {configuration.map(([name, value]) => (
            <div
              key={name}
              className="grid gap-1 px-4 py-3 sm:grid-cols-[14rem_1fr] sm:gap-4"
            >
              <dt className="text-sm font-medium text-[var(--muted-foreground)]">
                {name}
              </dt>
              <dd className="min-w-0 break-words font-mono text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
