import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Pencil, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyLink } from "@/components/ui/copy-link";
import { KbArticle } from "@/components/kb-article";
import { ReactionBar } from "@/components/kb-reactions";
import { requireScopedUser } from "@/server/auth/session";
import { readerKey } from "@/server/kb/identity";
import { publicAddressFor } from "@/server/kb/share";
import { getArticle } from "@/server/services/kb";
import { withImages } from "@/server/services/kb-images";
import { userMayWrite } from "@/server/services/kb-write";
import { readerReaction } from "@/server/services/kb-reactions";
import { getI18n } from "@/i18n/server";
import { setArticlePublicHiddenAction, toggleFavoriteAction, voteAction } from "../../actions";
import { isAdministrator } from "@/server/auth/roles";
import { listCategories, listCollections } from "@/server/services/kb";
import { listRevisions } from "@/server/services/kb-revisions";
import { isTextArticle } from "@/server/services/kb-curate";
import { originalOf } from "@/server/services/kb-import";
import { formatDateTime } from "@/i18n/format";
import { ArticleManage, type ManageHistoryRow } from "../../article-manage";

export const dynamic = "force-dynamic";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { articleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) notFound();

  const found = await getArticle(articleId, { scope, via: "app", userId: user.id });
  if (!found) notFound();
  const key = readerKey(user.email);
  const [article, reaction, publicHref, canWrite, { locale, messages: t }] = await Promise.all([
    withImages(found, `/api/kb/articles/${found.id}/images`),
    readerReaction(key, found.id),
    publicAddressFor(found),
    userMayWrite(user, found.collectionId),
    getI18n(),
  ]);

  const admin = isAdministrator(user.role);
  // A text file is edited in the editor: one written here by whoever may
  // write, one an import brought in by an administrator.
  const editable =
    (canWrite && !!article.externalId && article.format === "markdown") ||
    (admin && isTextArticle(article.sourceType));
  const editHref = editable ? `/kb/articles/${article.id}/edit` : null;

  let manage: React.ReactNode = null;
  if (admin) {
    const reader = { scope, via: "app" as const, userId: user.id };
    const [categories, collections, revisions] = await Promise.all([
      listCategories(article.collectionId, reader),
      listCollections(reader),
      listRevisions(article.id),
    ]);
    const m = t.kb.manage;
    const history: ManageHistoryRow[] = revisions.map((revision) => {
      const detail = revision.detail;
      const place = [detail.category, detail.subcategory].filter(Boolean).join(" › ");
      return {
        id: revision.id,
        action: revision.action,
        who: revision.userName ?? revision.actorName,
        when: formatDateTime(revision.createdAt, locale),
        detail:
          revision.action === "moved" && typeof detail.from === "string" && typeof detail.to === "string"
            ? m.movedDetail(detail.from, detail.to)
            : revision.action === "recategorized"
              ? m.filedDetail(place || m.none)
              : revision.action === "replaced" && typeof detail.file === "string"
                ? detail.file
                : null,
        viewHref: revision.hasBody ? `/kb/articles/${article.id}/history/${revision.id}` : null,
        fileHref: revision.original ? `/api/kb/articles/${article.id}/revisions/${revision.id}` : null,
      };
    });
    manage = (
      <ArticleManage
        articleId={article.id}
        collectionId={article.collectionId}
        category={article.category ?? ""}
        subcategory={article.subcategory ?? ""}
        categories={categories.map((row) => ({ category: row.category, subcategory: row.subcategory }))}
        collections={collections
          .filter((collection) => collection.id !== article.collectionId)
          .map((collection) => ({ id: collection.id, name: collection.name }))}
        editHref={isTextArticle(article.sourceType) ? editHref : null}
        downloadHref={originalOf(article.metadata) ? `/api/kb/articles/${article.id}/original` : null}
        history={history}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
    <KbArticle
      article={article}
      backHref={`/kb/${article.collectionId}`}
      originalHref={`/api/kb/articles/${article.id}/original`}
      locale={locale}
      t={t}
      actions={
        <>
          {publicHref && (
            <CopyLink href={publicHref} label={t.kb.publicLink} copiedLabel={t.kb.publicLinkCopied} />
          )}
          {admin && (
            <a
              href="#manage"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)]"
            >
              <Wrench className="size-4" aria-hidden />
              {t.kb.manage.link}
            </a>
          )}
          {editHref && (
            <Link
              href={editHref as Route}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)]"
            >
              <Pencil className="size-4" aria-hidden />
              {t.kb.editArticle}
            </Link>
          )}
          {
            // Only worth saying where the collection is on the public site at all.
            isAdministrator(user.role) && article.collectionPublic ? (
              <form action={setArticlePublicHiddenAction} className="flex items-center gap-2">
                <input type="hidden" name="id" value={article.id} />
                {!article.publicHidden && <input type="hidden" name="hidden" value="on" />}
                <span className="text-xs text-[var(--muted-foreground)]">
                  {!article.publicHidden
                    ? t.kb.onPublicSite
                    : article.hiddenBy === "rule"
                      ? t.kb.withheldByRule
                      : article.hiddenBy === "category"
                        ? t.kb.withheldWithCategory
                        : t.kb.withheld}
                </span>
                {
                  // Held by a rule or with its category, it is put back there, not here.
                  article.publicHidden && article.hiddenBy !== "manual" ? null : (
                    <Button type="submit" variant="outline" size="sm">
                      {article.publicHidden ? t.kb.publish : t.kb.withhold}
                    </Button>
                  )
                }
              </form>
            ) : null
          }
          <div className="basis-full">
            <ReactionBar
              article={article}
              reaction={reaction}
              toggleFavorite={toggleFavoriteAction}
              vote={voteAction}
              t={t}
            />
          </div>
        </>
      }
    />
    {manage}
    </div>
  );
}
