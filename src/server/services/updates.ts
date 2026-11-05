import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import {
  UPDATE_CHANNELS,
  updateEvents,
  updateSettings,
} from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { getBuildInfo } from "@/server/updates/build-info";
import {
  EVENT_STATUSES,
  type HostReport,
  type ParsedHostReport,
  type PendingChanges,
} from "@/server/updates/report";

/**
 * Automatic updates. An administrator picks a channel and an hour; the host
 * updater (updater/trove-kb-update.sh, a systemd timer on the server) reads that
 * policy, does the update itself, and reports back. The app never touches
 * Docker, git or systemd: the worst a compromised app can do through this is
 * switch between the two official channels.
 */

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export const updatePolicySchema = z.object({
  channel: z.enum(UPDATE_CHANNELS).optional(),
  updateHour: z.coerce.number().int().min(0).max(23).optional(),
});

export type UpdateEvent = {
  id: number;
  at: Date;
  status: (typeof EVENT_STATUSES)[number];
  channel: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  message: string | null;
};

export type UpdateStatus = {
  channel: UpdateChannel;
  updateHour: number;
  updateRequestedAt: Date | null;
  hostLastSeenAt: Date | null;
  lastReport: HostReport | null;
  pendingChanges: PendingChanges;
  /** Whether the host has a token to report with. */
  updaterConfigured: boolean;
  events: UpdateEvent[];
};

/** How many events the history keeps. */
const EVENTS_KEPT = 200;

async function settingsRow() {
  const [row] = await db.select().from(updateSettings).where(eq(updateSettings.id, true)).limit(1);
  if (row) return row;
  // First read on a fresh install: the defaults, written once.
  const [created] = await db
    .insert(updateSettings)
    .values({ id: true })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.select().from(updateSettings).where(eq(updateSettings.id, true)).limit(1))[0]!;
}

function updaterToken(): string | null {
  return process.env.TROVE_UPDATER_TOKEN?.trim() || null;
}

export async function getUpdateStatus(limit = 15): Promise<UpdateStatus> {
  const [row, events] = await Promise.all([
    settingsRow(),
    db.select().from(updateEvents).orderBy(desc(updateEvents.at), desc(updateEvents.id)).limit(limit),
  ]);
  const pending = row.pendingChanges as PendingChanges | null;
  return {
    channel: row.channel as UpdateChannel,
    updateHour: row.updateHour,
    updateRequestedAt: row.updateRequestedAt,
    hostLastSeenAt: row.hostLastSeenAt,
    lastReport: (row.lastReport as HostReport | null) ?? null,
    pendingChanges: pending && Array.isArray(pending.entries) ? pending : { total: 0, entries: [] },
    updaterConfigured: updaterToken() !== null,
    events: events.map((event) => ({
      ...event,
      status: event.status as UpdateEvent["status"],
    })),
  };
}

export async function setUpdatePolicy(input: unknown, actorId: string): Promise<void> {
  const parsed = updatePolicySchema.parse(input);
  const current = await settingsRow();

  const set: Partial<typeof updateSettings.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: actorId,
  };
  if (parsed.channel !== undefined) {
    set.channel = parsed.channel;
    // A pending "update now" belongs to the channel it was asked on.
    if (parsed.channel !== current.channel) {
      set.updateRequestedAt = null;
      set.updateRequestedBy = null;
    }
  }
  if (parsed.updateHour !== undefined) set.updateHour = parsed.updateHour;

  await db.transaction(async (tx) => {
    await tx.update(updateSettings).set(set).where(eq(updateSettings.id, true));
    await writeAudit(
      {
        userId: actorId,
        action: "updates.policy_changed",
        entity: "instance",
        entityId: null,
        detail: {
          channel: parsed.channel ?? current.channel,
          updateHour: parsed.updateHour ?? current.updateHour,
          previousChannel: current.channel,
          previousUpdateHour: current.updateHour,
        },
      },
      tx,
    );
  });
}

export class UpdateNotAllowedError extends Error {}

/** The host picks this up on its next run instead of waiting for the hour. */
export async function requestUpdateNow(actorId: string): Promise<void> {
  const current = await settingsRow();
  if (current.channel === "manual") {
    throw new UpdateNotAllowedError("Manual updates are run on the server.");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(updateSettings)
      .set({ updateRequestedAt: new Date(), updateRequestedBy: actorId })
      .where(eq(updateSettings.id, true));
    await writeAudit(
      {
        userId: actorId,
        action: "updates.requested",
        entity: "instance",
        entityId: null,
        detail: { channel: current.channel },
      },
      tx,
    );
  });
}

/* ---------- The host's side ---------- */

/** Constant time, whatever the lengths. */
export function updaterTokenMatches(presented: string | null, expected = updaterToken()): boolean {
  if (!expected || !presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function isUpdaterConfigured(): boolean {
  return updaterToken() !== null;
}

/**
 * What the host reads each run, as key=value lines so a shell script needs no
 * JSON parser. The running commit doubles as its health check after an update.
 */
export async function policyText(): Promise<string> {
  const row = await settingsRow();
  const build = getBuildInfo();
  return [
    `channel=${row.channel}`,
    `update_hour=${row.updateHour}`,
    `update_now=${row.updateRequestedAt ? 1 : 0}`,
    `running_version=${build.version}`,
    `running_commit=${build.commit ?? "unknown"}`,
    "",
  ].join("\n");
}

/** Every run reports; updates, rollbacks and failures also join the history. */
export async function recordHostReport({ report, pending }: ParsedHostReport): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(updateSettings)
      .set({
        lastReport: report as unknown as Record<string, unknown>,
        hostLastSeenAt: new Date(),
        ...(report.handledRequest ? { updateRequestedAt: null, updateRequestedBy: null } : {}),
        ...(pending ? { pendingChanges: pending as unknown as Record<string, unknown> } : {}),
      })
      .where(eq(updateSettings.id, true));

    const status = report.status;
    if (!(EVENT_STATUSES as readonly string[]).includes(status)) return;

    await tx.insert(updateEvents).values({
      status,
      channel: report.channel,
      fromVersion: report.previousVersion,
      toVersion: report.targetVersion,
      message: report.message,
    });
    await writeAudit(
      {
        userId: null,
        action: `updates.${status}`,
        entity: "instance",
        entityId: null,
        detail: {
          channel: report.channel,
          from: report.previousVersion,
          to: report.targetVersion,
          message: report.message,
        },
      },
      tx,
    );

    // The history is for reading, not an archive: the audit log keeps the rest.
    const keep = tx
      .select({ id: updateEvents.id })
      .from(updateEvents)
      .orderBy(desc(updateEvents.at), desc(updateEvents.id))
      .limit(EVENTS_KEPT);
    await tx.delete(updateEvents).where(notInArray(updateEvents.id, keep));
  });
}

/* ---------- Counts for System health ---------- */

export type SystemCounts = {
  companies: number;
  documents: number;
  kbArticles: number;
  users: number;
  /** Webhook deliveries still waiting for a retry. */
  webhooksWaiting: number;
  databaseBytes: number | null;
  databaseStartedAt: Date | null;
};

/**
 * Instance-wide totals. Only the administration area shows them, and an
 * administrator sees every company, so no CompanyScope narrows them.
 */
export async function getSystemCounts(): Promise<SystemCounts> {
  const result = await db.execute<Record<string, string | number | Date | null>>(sql`
    select
      (select count(*) from companies where archived_at is null) as companies,
      (select count(*) from documents where archived_at is null) as documents,
      (select count(*) from kb_articles where archived_at is null) as kb_articles,
      (select count(*) from users) as users,
      (select count(*) from webhook_deliveries
        where delivered_at is null and next_retry_at is not null) as webhooks_waiting,
      pg_database_size(current_database()) as database_bytes,
      pg_postmaster_start_time() as database_started_at
  `);
  const row = result.rows[0] ?? {};
  const number = (value: unknown) => (value == null ? 0 : Number(value));
  return {
    companies: number(row.companies),
    documents: number(row.documents),
    kbArticles: number(row.kb_articles),
    users: number(row.users),
    webhooksWaiting: number(row.webhooks_waiting),
    databaseBytes: row.database_bytes == null ? null : Number(row.database_bytes),
    databaseStartedAt: row.database_started_at ? new Date(row.database_started_at as string) : null,
  };
}
