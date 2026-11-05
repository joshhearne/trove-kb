import { z } from "zod";
import { UPDATE_CHANNELS } from "@/server/db/schema";
import { parseChange, type ChangeEntry } from "@/lib/changes";

/**
 * What the host updater (updater/trove-kb-update.sh) sends after every run, as
 * a form. Validated here so the route stays a translation layer.
 */

export const EVENT_STATUSES = ["updated", "rolled_back", "failed"] as const;
export const REPORT_STATUSES = ["up_to_date", "waiting", "manual", ...EVENT_STATUSES] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

const clipped = (max: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value ? value.slice(0, max) : null));

export const hostReportSchema = z.object({
  status: z.enum(REPORT_STATUSES),
  message: clipped(2000),
  channel: z
    .string()
    .optional()
    .transform((value) =>
      (UPDATE_CHANNELS as readonly string[]).includes(value ?? "") ? value! : null,
    ),
  /** docker or bare-metal: how this host runs the app. */
  mode: clipped(20),
  previousVersion: clipped(100),
  targetVersion: clipped(100),
  currentVersion: clipped(100),
  currentCommit: clipped(64),
  availableVersion: clipped(100),
  hostTime: clipped(40),
  hostTz: clipped(64),
  handledRequest: z
    .string()
    .optional()
    .transform((value) => value === "1"),
});

export type HostReport = z.infer<typeof hostReportSchema>;

export type PendingChanges = { total: number; entries: ChangeEntry[] };

export type ParsedHostReport = {
  report: HostReport;
  /** Null when this run did not send a set, so the last one stands. */
  pending: PendingChanges | null;
};

const MAX_PENDING = 200;

/** Reads the form the updater posts: snake_case keys, repeated pending_change. */
export function parseHostReport(form: FormData | URLSearchParams): ParsedHostReport {
  const get = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : undefined;
  };

  const report = hostReportSchema.parse({
    status: get("status"),
    message: get("message"),
    channel: get("channel"),
    mode: get("mode"),
    previousVersion: get("previous_version"),
    targetVersion: get("target_version"),
    currentVersion: get("current_version"),
    currentCommit: get("current_commit"),
    availableVersion: get("available_version"),
    hostTime: get("host_time"),
    hostTz: get("host_tz"),
    handledRequest: get("handled_request"),
  });

  // Each change file new in the build it would install, as "<name>\n<text>".
  // pending_changes_sent=1 marks a report carrying the full set, maybe empty.
  let pending: PendingChanges | null = null;
  if (get("pending_changes_sent") === "1") {
    const entries = form
      .getAll("pending_change")
      .slice(0, MAX_PENDING)
      .map((value) => {
        if (typeof value !== "string") return null;
        const newline = value.indexOf("\n");
        return newline > 0 ? parseChange(value.slice(0, newline).trim(), value.slice(newline + 1)) : null;
      })
      .filter((entry): entry is ChangeEntry => entry !== null);
    const total = Number(get("pending_changes_total"));
    pending = {
      total: Number.isInteger(total) && total >= entries.length ? total : entries.length,
      entries,
    };
  }

  return { report, pending };
}
