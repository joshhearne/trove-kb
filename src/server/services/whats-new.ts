import "server-only";
import { and, desc, eq, gt, inArray, notExists, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { changeEntries, changeReleases, users } from "@/server/db/schema";
import { getBuildInfo } from "@/server/updates/build-info";
import {
  loadChanges,
  visibleTo,
  type ChangeAudience,
  type ChangeEntry,
  type ChangeKind,
} from "@/server/updates/changes";

/**
 * The What's new pop-up. The change files in this build (changes/*.md) are
 * compared with what the database has seen: anything new is a release, and
 * everyone signed in sees it once, filtered to what concerns them. A rollback
 * boots a build without the newest files; those entries go again, with any
 * release left empty, so the pop-up never describes a build that isn't running.
 */

export type Release = {
  id: number;
  version: string | null;
  deployedAt: Date;
  entries: ChangeEntry[];
};

/** Brings the database in line with this build's change files. Once at boot. */
export async function syncChanges({
  entries = loadChanges(),
  version = getBuildInfo().version,
  commit = getBuildInfo().commit,
}: { entries?: ChangeEntry[]; version?: string | null; commit?: string | null } = {}): Promise<{
  added: number;
  removed: number;
}> {
  return db.transaction(async (tx) => {
    // Two replicas booting together record one release, not two.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('trove-kb:whats-new'))`);

    const known = await tx.select({ id: changeEntries.id }).from(changeEntries);
    const knownIds = new Set(known.map((row) => row.id));
    const fileIds = new Set(entries.map((entry) => entry.id));

    const gone = [...knownIds].filter((id) => !fileIds.has(id));
    if (gone.length > 0) {
      await tx.delete(changeEntries).where(inArray(changeEntries.id, gone));
      await tx
        .delete(changeReleases)
        .where(
          notExists(
            tx
              .select({ one: sql`1` })
              .from(changeEntries)
              .where(eq(changeEntries.releaseId, changeReleases.id)),
          ),
        );
    }

    // Wording fixed after an entry shipped reaches running installs too.
    for (const entry of entries.filter((item) => knownIds.has(item.id))) {
      await tx
        .update(changeEntries)
        .set({ kind: entry.kind, audience: entry.audience, items: entry.items })
        .where(eq(changeEntries.id, entry.id));
    }

    const fresh = entries.filter((entry) => !knownIds.has(entry.id));
    if (fresh.length > 0) {
      const [release] = await tx
        .insert(changeReleases)
        .values({ version: version ?? null, commit: commit ?? null })
        .returning({ id: changeReleases.id });
      await tx.insert(changeEntries).values(
        fresh.map((entry) => ({
          id: entry.id,
          releaseId: release!.id,
          kind: entry.kind,
          audience: entry.audience,
          items: entry.items,
        })),
      );
    }

    return { added: fresh.length, removed: gone.length };
  });
}

async function releasesWhere(
  where: ReturnType<typeof and>,
  administrator: boolean,
  limit: number,
): Promise<Release[]> {
  const rows = await db
    .select({
      id: changeReleases.id,
      version: changeReleases.version,
      deployedAt: changeReleases.deployedAt,
      entryId: changeEntries.id,
      kind: changeEntries.kind,
      audience: changeEntries.audience,
      items: changeEntries.items,
    })
    .from(changeReleases)
    .innerJoin(changeEntries, eq(changeEntries.releaseId, changeReleases.id))
    .where(where)
    .orderBy(desc(changeReleases.id), changeEntries.id);

  const releases = new Map<number, Release>();
  for (const row of rows) {
    let release = releases.get(row.id);
    if (!release) {
      release = { id: row.id, version: row.version, deployedAt: row.deployedAt, entries: [] };
      releases.set(row.id, release);
    }
    release.entries.push({
      id: row.entryId,
      kind: row.kind as ChangeKind,
      audience: row.audience as ChangeAudience,
      items: row.items,
    });
  }

  return [...releases.values()]
    .map((release) => ({ ...release, entries: visibleTo(release.entries, administrator) }))
    .filter((release) => release.entries.length > 0)
    .slice(0, limit);
}

/**
 * Releases this person has not closed yet: deployed since their account was
 * made (a new account starts with nothing to catch up on), newest first, and
 * only those with something for them.
 */
export async function unseenReleases(
  userId: string,
  administrator: boolean,
): Promise<Release[]> {
  const [user] = await db
    .select({ seen: users.whatsNewSeenReleaseId, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return [];

  return releasesWhere(
    and(gt(changeReleases.id, user.seen ?? 0), gt(changeReleases.deployedAt, user.createdAt)),
    administrator,
    10,
  );
}

/** Recent releases, for the history on System health. */
export async function recentReleases(administrator: boolean, limit = 10): Promise<Release[]> {
  return releasesWhere(undefined, administrator, limit);
}

/** They closed the pop-up: nothing up to this release shows again. */
export async function markReleasesSeen(userId: string, releaseId: number): Promise<void> {
  if (!Number.isInteger(releaseId) || releaseId < 1) return;
  await db
    .update(users)
    .set({
      whatsNewSeenReleaseId: sql`greatest(coalesce(${users.whatsNewSeenReleaseId}, 0), ${releaseId})`,
    })
    .where(eq(users.id, userId));
}
