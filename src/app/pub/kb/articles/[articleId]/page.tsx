import { notFound } from "next/navigation";
import { resolveWikilinks } from "@/server/services/wikilinks";
import { expandRunbook, nestedTexts } from "@/server/services/kb-runbooks";
import { listPageBacklinks } from "@/server/services/kb-links";
import { KbArticle } from "@/components/kb-article";
import { ReactionBar } from "@/components/kb-reactions";
import { publicIdentity } from "@/server/kb/identity";
import { requirePublicReader } from "@/server/kb/public";
import { getArticle } from "@/server/services/kb";
import { withImages } from "@/server/services/kb-images";
import { readerReaction } from "@/server/services/kb-reactions";
import { getI18n } from "@/i18n/server";
import { toggleFavoriteAction, voteAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function PublicArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const reader = await requirePublicReader();
  const { articleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) notFound();

  const found = await getArticle(articleId, reader);
  if (!found) notFound();
  const [article, identity, { locale, messages: t }] = await Promise.all([
    withImages(found, `/pub/kb/articles/${found.id}/images`),
    publicIdentity(),
    getI18n(),
  ]);
  const reaction = identity ? await readerReaction(identity.key, article.id) : null;
  // A runbook's links to other runbooks, opened into their steps as this visitor may read them.
  const nested = await expandRunbook(found, reader);

  return (
    <KbArticle
      nested={nested}
      links={await resolveWikilinks([found.body, ...nestedTexts(nested)], { scope: reader.scope, kb: reader, publicSite: true })}
      backlinks={await listPageBacklinks({ kind: "kb", id: found.id }, { scope: reader.scope, kb: reader, publicSite: true })}
      articleBase="/pub/kb/articles"
      article={article}
      backHref={`/pub/kb/${article.collectionId}`}
      originalHref={`/pub/kb/articles/${article.id}/original`}
      exportHref={`/pub/kb/articles/${article.id}/export`}
      locale={locale}
      t={t}
      actions={
        reaction ? (
          <ReactionBar
            article={article}
            reaction={reaction}
            toggleFavorite={toggleFavoriteAction}
            vote={voteAction}
            t={t}
          />
        ) : article.helpful !== null ? (
          <span className="text-sm text-[var(--muted-foreground)]">
            {t.kb.helpfulScore(article.helpful, article.votes)}
          </span>
        ) : undefined
      }
    />
  );
}
