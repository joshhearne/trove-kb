"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/alert";
import { ChangeKey, ChangeList } from "@/components/change-list";
import { useMessages } from "@/i18n/client";
import type { ChangeEntry } from "@/lib/changes";
import { cn } from "@/lib/utils";
import {
  requestUpdateNowAction,
  setUpdateChannelAction,
  setUpdateHourAction,
  type SystemActionResult,
} from "./system-actions";

const REFRESH_MS = 30_000;

/** "Generated …" and a refresh button; the page re-renders itself every 30 seconds. */
export function SystemRefresh({ generated }: { generated: string }) {
  const t = useMessages();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setInterval(() => startTransition(() => router.refresh()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
      <span>{t.admin.system.generated(generated)}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} aria-hidden />
        {pending ? t.admin.system.refreshing : t.admin.system.refresh}
      </Button>
    </div>
  );
}

const CHANNELS = ["production", "development", "manual"] as const;
type Channel = (typeof CHANNELS)[number];

const TONE: Record<string, string> = {
  updated: "text-emerald-700 dark:text-emerald-300",
  up_to_date: "text-emerald-700 dark:text-emerald-300",
  waiting: "text-[var(--muted-foreground)]",
  manual: "text-[var(--muted-foreground)]",
  rolled_back: "text-amber-700 dark:text-amber-300",
  failed: "text-[var(--destructive)]",
};

export type UpdatesPanelProps = {
  channel: Channel;
  updateHour: number;
  updateRequested: boolean;
  updaterConfigured: boolean;
  /** Formatted for the reader; null when the host never reported. */
  hostLastSeen: string | null;
  hostStale: boolean;
  running: string;
  report: {
    status: string;
    message: string | null;
    availableVersion: string | null;
    /** The channel the host checked; null from a host that didn't say. */
    channel: string | null;
    hostTz: string | null;
    mode: string | null;
  } | null;
  pending: { total: number; entries: ChangeEntry[] };
  events: {
    id: number;
    status: "updated" | "rolled_back" | "failed";
    fromVersion: string | null;
    toVersion: string | null;
    message: string | null;
    at: string;
  }[];
};

const label = "text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]";

/** Admin → System health → Updates: the channel, the hour, and what the host said. */
export function UpdatesPanel(props: UpdatesPanelProps) {
  const t = useMessages();
  const s = t.admin.system;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // What was just chosen shows at once; the refreshed page then has the say.
  const [channel, setChannel] = useOptimistic(props.channel);
  const [hour, setHour] = useOptimistic(props.updateHour);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function act(work: () => Promise<SystemActionResult>, success: string, optimistic?: () => void) {
    startTransition(async () => {
      optimistic?.();
      const result = await work();
      setMessage(result.error ? { ok: false, text: result.error } : { ok: true, text: success });
      router.refresh();
    });
  }

  const report = props.report;
  // After a change of channel, the last report (and its preview) answers for
  // the old one: a release where a dev build is now wanted, or the reverse.
  const reportCurrent = !report?.channel || report.channel === channel;
  const available = reportCurrent ? report?.availableVersion ?? null : null;
  const command = (text: string) => (
    <code className="mt-1 block rounded bg-[var(--muted)] px-2 py-1 font-mono text-xs">{text}</code>
  );

  return (
    <section className="overflow-hidden rounded-lg border bg-[var(--card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-[var(--muted)]/40 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{s.updates}</h3>
        {channel !== "manual" && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending || props.updateRequested || !props.hostLastSeen}
            onClick={() => act(requestUpdateNowAction, s.updateNowSent)}
          >
            {props.updateRequested ? s.updateRequested : s.updateNow}
          </Button>
        )}
      </div>

      {(!props.updaterConfigured || !props.hostLastSeen || props.hostStale) && (
        <div className="border-b px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {!props.updaterConfigured ? (
            <>
              {s.notInstalled}
              {command("sudo updater/install-updater.sh")}
            </>
          ) : !props.hostLastSeen ? (
            <>
              {s.neverSeen}
              {command("systemctl list-timers trove-kb-update.timer")}
            </>
          ) : (
            <>
              {s.stale(props.hostLastSeen)}
              {command("journalctl -u trove-kb-update.service")}
            </>
          )}
        </div>
      )}

      {message && (
        <div className="border-b px-4 py-2 text-sm" role="status">
          {message.ok ? (
            <span className="text-emerald-700 dark:text-emerald-300">{message.text}</span>
          ) : (
            <FormError>{message.text}</FormError>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 p-4 text-sm md:grid-cols-2">
        <fieldset className="flex flex-col gap-2" disabled={pending}>
          <legend className={cn(label, "mb-1")}>{s.channel}</legend>
          {CHANNELS.map((value) => (
            <label key={value} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="update-channel"
                className="mt-1"
                checked={channel === value}
                onChange={() =>
                  act(() => setUpdateChannelAction(value), s.saved, () => setChannel(value))
                }
              />
              <span>
                <span className="font-medium">{s.channels[value]}</span>
                <span className="block text-xs text-[var(--muted-foreground)]">{s.channelHints[value]}</span>
              </span>
            </label>
          ))}

          {channel !== "manual" && (
            <div className="pt-2">
              <label htmlFor="update-hour" className={cn(label, "mb-1 block")}>
                {report?.hostTz ? s.updateHourZone(report.hostTz) : s.updateHour}
              </label>
              <Select
                id="update-hour"
                value={hour}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  act(() => setUpdateHourAction(next), s.saved, () => setHour(next));
                }}
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
              >
                {Array.from({ length: 24 }, (_, value) => (
                  <option key={value} value={value}>
                    {`${String(value).padStart(2, "0")}:00`}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{s.updateHourHint}</p>
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={label}>{s.running}</div>
              <div className="break-all font-mono">{props.running}</div>
            </div>
            <div>
              <div className={label}>{s.latestAvailable}</div>
              <div className="break-all font-mono">
                {available ?? (
                  <span className={cn("text-[var(--muted-foreground)]", !reportCurrent && "font-sans text-xs")}>
                    {reportCurrent ? s.unknown : s.awaitingCheck(s.channels[channel])}
                  </span>
                )}
              </div>
            </div>
          </div>

          {report && (
            <div>
              <div className={label}>{s.lastCheck}</div>
              <p className={TONE[report.status] ?? ""}>{report.message}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {props.hostLastSeen}
                {report.mode && ` · ${s.hostMode(report.mode)}`}
              </p>
            </div>
          )}

          {channel === "manual" && (
            <div>
              <div className={cn(label, "mb-1")}>{s.byHand}</div>
              <pre className="whitespace-pre-wrap rounded bg-[var(--muted)] p-2 font-mono text-xs">{`git fetch --tags && git checkout <release tag>
# Docker: set TROVE_IMAGE_TAG=<release tag> in .env
docker compose pull && docker compose up -d
# Bare metal: updater/trove-kb-update.sh --install <release tag>`}</pre>
            </div>
          )}
        </div>
      </div>

      {reportCurrent && props.pending.total > 0 && (
        <div className="border-t px-4 py-3">
          <details open={props.pending.total <= 10}>
            <summary className={cn(label, "cursor-pointer")}>
              {available ? (
                <>
                  {s.comingIn("")}
                  <span className="font-mono normal-case">{available}</span>
                </>
              ) : (
                s.comingIn(s.nextUpdate)
              )}
              {" · "}
              {s.changeCount(props.pending.total)}
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <ChangeList entries={props.pending.entries} />
              {props.pending.total > props.pending.entries.length && (
                <p className="text-xs text-[var(--muted-foreground)]">
                  {s.andMore(props.pending.total - props.pending.entries.length)}
                </p>
              )}
              <ChangeKey />
              <p className="text-xs text-[var(--muted-foreground)]">{s.previewNote}</p>
            </div>
          </details>
        </div>
      )}

      <div className="border-t px-4 py-3">
        <div className={cn(label, "mb-2")}>{s.recentUpdates}</div>
        {props.events.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">{s.noUpdates}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {props.events.map((event) => (
              <li key={event.id} className="flex flex-wrap gap-x-2" title={event.message ?? undefined}>
                <span className={cn("font-medium", TONE[event.status])}>{s.events[event.status]}</span>
                <span className="font-mono text-[var(--muted-foreground)]">
                  {event.fromVersion ?? "?"} → {event.toVersion ?? "?"}
                </span>
                <span className="text-[var(--muted-foreground)]">{event.at}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
