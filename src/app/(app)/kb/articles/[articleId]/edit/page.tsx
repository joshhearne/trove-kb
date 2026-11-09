import { notFound } from "next/navigation";
import { hasRecentMfa, requireScopedUser } from "@/server/auth/session";
import { getArticle, listCategories, listCollections, type KbReader } from "@/server/services/kb";
import { userMayWrite } from "@/server/services/kb-write";
import { getI18n } from "@/i18n/server";
import { KbEditor } from "../../../kb-editor";
import { isAdministrator } from "@/server/auth/roles";
import { isTextArticle } from "@/server/services/kb-curate";

export const dynamic = "force-dynamic";

export default async function EditArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<{ unlock?: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { articleId } = await params;
  const { unlock } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) notFound();
  const reader: KbReader = { scope, via: "app", userId: user.id };
  const article = await getArticle(articleId, reader);
  if (!article) notFound();
  // An article with a name of its own is written again under it, by whoever
  // may write there. A text file an import brought in is edited in place,
  // by an administrator; anything else gets a new file, not an edit.
  const written = !!article.externalId && article.format === "markdown";
  const importedText = !written && isAdministrator(user.role) && isTextArticle(article.sourceType);
  if (!written && !importedText) notFound();
  if (!(await userMayWrite(user, article.collectionId))) notFound();
  const canMove = isAdministrator(user.role);
  const [categories, collections, { messages: t }] = await Promise.all([
    listCategories(article.collectionId, reader),
    canMove ? listCollections(reader) : Promise.resolve([]),
    getI18n(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-[var(--muted-foreground)]">{article.collectionName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t.kb.editor.editTitle}</h1>
      </div>
      <KbEditor
        backHref={`/kb/articles/${article.id}`}
        categories={categories.map((row) => ({ category: row.category, subcategory: row.subcategory }))}
        collections={collections.map((row) => ({ id: row.id, name: row.name }))}
        collectionName={article.collectionName}
        canMove={canMove}
        textOnly={importedText}
        moveUnlocked={canMove && unlock === "move" && hasRecentMfa(user)}
        values={{
          articleId: article.id,
          collectionId: article.collectionId,
          externalId: written ? (article.externalId ?? undefined) : undefined,
          title: article.title,
          category: article.category ?? "",
          subcategory: article.subcategory ?? "",
          kind: article.kind,
          internalOnly: article.hiddenBy === "manual",
          body: article.body,
          steps: article.steps,
          imported: article.sourcePath !== null || article.sourceType !== "md",
        }}
      />
    </div>
  );
}
