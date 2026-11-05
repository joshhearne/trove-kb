import { getI18n } from "@/i18n/server";
import { formatBytes, formatDate, formatDateTime, formatNumber } from "@/i18n/format";
import { getBuildInfo } from "@/server/updates/build-info";
import { getSystemCounts, getUpdateStatus } from "@/server/services/updates";
import { recentReleases } from "@/server/services/whats-new";
import { ChangeList } from "@/components/change-list";
import { SystemRefresh, UpdatesPanel } from "../system-panels";

export const dynamic = "force-dynamic";

/** The host updater runs every 10 minutes; three missed runs is worth saying. */
const HOST_STALE_MS = 30 * 60_000;

/**
 * Which build is running, how this server updates, what the next update
 * brings, and the history of what was installed. The admin layout has already
 * checked the area; the changes themselves ask for a fresh second step.
 */
export default async function SystemHealthPage() {
  const [{ locale, messages: t }, status, counts, releases] = await Promise.all([
    getI18n(),
    getUpdateStatus(),
    getSystemCounts().catch(() => null),
    recentReleases(true, 10),
  ]);
  const s = t.admin.system;
  const build = getBuildInfo();
  const now = new Date();

  const label = "text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]";
  const hostStale =
    status.hostLastSeenAt !== null && now.getTime() - status.hostLastSeenAt.getTime() > HOST_STALE_MS;

  const stats: { label: string; value: string; sub?: string }[] = counts
    ? [
        { label: s.counts.companies, value: formatNumber(counts.companies, locale) },
        { label: s.counts.documents, value: formatNumber(counts.documents, locale) },
        { label: s.counts.kbArticles, value: formatNumber(counts.kbArticles, locale) },
        { label: s.counts.users, value: formatNumber(counts.users, locale) },
        { label: s.counts.webhooksWaiting, value: formatNumber(counts.webhooksWaiting, locale) },
        {
          label: s.counts.database,
          value: counts.databaseBytes === null ? "—" : formatBytes(counts.databaseBytes, locale),
          ...(counts.databaseStartedAt
            ? { sub: s.counts.upSince(formatDateTime(counts.databaseStartedAt, locale)) }
            : {}),
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{s.title}</h2>
          <p className="text-sm text-[var(--muted-foreground)]">{s.subtitle}</p>
        </div>
        <SystemRefresh generated={formatDateTime(now, locale)} />
      </div>

      <section className="overflow-hidden rounded-lg border bg-[var(--card)]">
        <div className="border-b bg-[var(--muted)]/40 px-4 py-2.5">
          <h3 className="text-sm font-semibold">{s.buildInfo}</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-3">
          <div>
            <div className={label}>{s.version}</div>
            <div className="break-all font-mono">{build.version}</div>
          </div>
          <div>
            <div className={label}>{s.commit}</div>
            <div className="break-all font-mono">{build.commit ?? s.unknown}</div>
          </div>
          <div>
            <div className={label}>{s.built}</div>
            <div className="font-mono">
              {build.builtAt ? formatDateTime(build.builtAt, locale) : s.unknown}
            </div>
          </div>
        </div>
      </section>

      <UpdatesPanel
        channel={status.channel}
        updateHour={status.updateHour}
        updateRequested={status.updateRequestedAt !== null}
        updaterConfigured={status.updaterConfigured}
        hostLastSeen={status.hostLastSeenAt ? formatDateTime(status.hostLastSeenAt, locale) : null}
        hostStale={hostStale}
        running={build.version}
        report={
          status.lastReport
            ? {
                status: status.lastReport.status,
                message: status.lastReport.message,
                availableVersion: status.lastReport.availableVersion,
                channel: status.lastReport.channel,
                hostTz: status.lastReport.hostTz,
                mode: status.lastReport.mode,
              }
            : null
        }
        pending={status.pendingChanges}
        events={status.events.map((event) => ({
          id: event.id,
          status: event.status,
          fromVersion: event.fromVersion,
          toVersion: event.toVersion,
          message: event.message,
          at: formatDateTime(event.at, locale),
        }))}
      />

      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border bg-[var(--card)] p-3">
              <div className="text-[11px] uppercase tracking-wider text-[var(--muted-foreground)]">
                {stat.label}
              </div>
              <div className="mt-1 text-2xl font-semibold">{stat.value}</div>
              {stat.sub && <div className="mt-1 text-xs text-[var(--muted-foreground)]">{stat.sub}</div>}
            </div>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold">{s.releases}</h3>
          <p className="text-sm text-[var(--muted-foreground)]">{s.releasesHint}</p>
        </div>
        {releases.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">{s.noReleases}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {releases.map((release) => (
              <li key={release.id} className="rounded-lg border bg-[var(--card)] p-4">
                <p className={`${label} mb-2`}>
                  <span className="font-mono normal-case">{release.version ?? t.whatsNew.title}</span>
                  {" · "}
                  {formatDate(release.deployedAt.toISOString().slice(0, 10), locale)}
                </p>
                <ChangeList entries={release.entries} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
