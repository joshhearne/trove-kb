import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireScopedUser } from "@/server/auth/session";
import { isAdministrator } from "@/server/auth/roles";
import { getArticle } from "@/server/services/kb";
import { getRevision } from "@/server/services/kb-revisions";
import { getI18n } from "@/i18n/server";
import { formatDateTime } from "@/i18n/format";

export const dynamic = "force-dynamic";

/** What an article said before one change, from its history. Administrators only. */
export default async function ArticleRevisionPage({
  params,
}: {
  params: Promise<{ articleId: string; revisionId: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  if (!isAdministrator(user.role)) notFound();
  const { articleId, revisionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId) || !/^\d+$/.test(revisionId)) notFound();

  const article = await getArticle(articleId, { scope, via: "app", userId: user.id });
  const revision = article ? await getRevision(articleId, Number(revisionId)) : null;
  if (!article || !revision) notFound();
  const { locale, messages: t } = await getI18n();
  const m = t.kb.manage;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <Link href={`/kb/articles/${article.id}#manage` as Route} className="text-sm underline">
          {m.revisionBack}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{revision.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {m.revisionTitle(formatDateTime(revision.createdAt, locale))} · {m.actions[revision.action as keyof typeof m.actions]}
        </p>
      </div>
      {revision.original && (
        <a href={`/api/kb/articles/${article.id}/revisions/${revision.id}`} download className="text-sm underline">
          {m.previousFile}: {revision.original.name}
        </a>
      )}
      {revision.body === null ? (
        <p className="text-sm text-[var(--muted-foreground)]">{m.revisionNoText}</p>
      ) : (
        // Shown as the text it was, never rendered: it is a record, not a page.
        <pre className="whitespace-pre-wrap break-words rounded-md border bg-[var(--muted)]/40 p-4 font-mono text-sm">
          {revision.body}
        </pre>
      )}
    </div>
  );
}
