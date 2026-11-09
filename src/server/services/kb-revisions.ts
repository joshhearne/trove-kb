import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { kbArticleRevisions, users, KB_REVISION_ACTIONS } from "@/server/db/schema";
import type { OriginalFile } from "@/server/services/kb-import";

type Executor = Pick<typeof db, "insert">;

export type RevisionAction = (typeof KB_REVISION_ACTIONS)[number];

/** Who made a change: a person, or a key by its name. */
export type RevisionActor = { userId: string | null; name: string };

/** What the article was before the change, as the row held it. */
export type ArticleBefore = {
  id: string;
  collectionId: string;
  title: string;
  category: string | null;
  subcategory: string | null;
  body?: string | null;
  original?: OriginalFile | null;
};

/**
 * Records one change to an article: what it was before, and who changed it.
 * The text is kept only for a change to the text; the file only for a new file.
 */
export async function recordRevision(
  action: RevisionAction,
  before: ArticleBefore,
  actor: RevisionActor,
  detail: Record<string, unknown> = {},
  tx: Executor = db,
): Promise<void> {
  await tx.insert(kbArticleRevisions).values({
    articleId: before.id,
    action,
    userId: actor.userId,
    actorName: actor.name,
    collectionId: before.collectionId,
    title: before.title,
    category: before.category,
    subcategory: before.subcategory,
    body: before.body ?? null,
    original: (before.original ?? null) as Record<string, unknown> | null,
    detail,
  });
}

export type Revision = {
  id: number;
  action: RevisionAction;
  actorName: string | null;
  userName: string | null;
  createdAt: Date;
  title: string;
  category: string | null;
  subcategory: string | null;
  hasBody: boolean;
  original: OriginalFile | null;
  detail: Record<string, unknown>;
};

/** An article's history, newest first. The caller has already checked it may see the article. */
export async function listRevisions(articleId: string, limit = 50): Promise<Revision[]> {
  const rows = await db
    .select({
      id: kbArticleRevisions.id,
      action: kbArticleRevisions.action,
      actorName: kbArticleRevisions.actorName,
      userName: users.name,
      createdAt: kbArticleRevisions.createdAt,
      title: kbArticleRevisions.title,
      category: kbArticleRevisions.category,
      subcategory: kbArticleRevisions.subcategory,
      body: kbArticleRevisions.body,
      original: kbArticleRevisions.original,
      detail: kbArticleRevisions.detail,
    })
    .from(kbArticleRevisions)
    .leftJoin(users, eq(users.id, kbArticleRevisions.userId))
    .where(eq(kbArticleRevisions.articleId, articleId))
    .orderBy(desc(kbArticleRevisions.createdAt), desc(kbArticleRevisions.id))
    .limit(limit);

  return rows.map(({ body, original, detail, action, ...row }) => ({
    ...row,
    action: action as RevisionAction,
    hasBody: body !== null,
    original: (original as OriginalFile | null) ?? null,
    detail: detail ?? {},
  }));
}

/** One revision of an article, text and file included. */
export async function getRevision(articleId: string, revisionId: number) {
  const [row] = await db
    .select()
    .from(kbArticleRevisions)
    .where(eq(kbArticleRevisions.id, revisionId))
    .limit(1);
  if (!row || row.articleId !== articleId) return null;
  return { ...row, original: (row.original as OriginalFile | null) ?? null };
}
