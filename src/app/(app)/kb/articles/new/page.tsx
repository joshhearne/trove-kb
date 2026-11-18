import { notFound } from "next/navigation";
import { requireScopedUser } from "@/server/auth/session";
import { getCollection, listCategories } from "@/server/services/kb";
import { userMayWrite } from "@/server/services/kb-write";
import { getI18n } from "@/i18n/server";
import { MAX_ENTRY_BYTES } from "@/server/kb/zip";
import { KbEditor } from "../../kb-editor";

export const dynamic = "force-dynamic";

export default async function NewArticlePage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string }>;
}) {
  const { user, scope } = await requireScopedUser();
  const { collection: collectionId } = await searchParams;
  if (!collectionId || !/^[0-9a-f-]{36}$/i.test(collectionId)) notFound();
  const reader = { scope, via: "app" as const, userId: user.id };
  const collection = await getCollection(collectionId, reader);
  if (!collection || !(await userMayWrite(user, collection.id))) notFound();
  const [categories, { messages: t }] = await Promise.all([listCategories(collection.id, reader), getI18n()]);

  return (
    <KbEditor
        header={
          <>
            <p className="text-sm text-[var(--muted-foreground)]">{collection.name}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{t.kb.editor.newTitle}</h1>
          </>
        }
        maxUploadMb={Math.floor(MAX_ENTRY_BYTES / (1024 * 1024))}
        backHref={`/kb/${collection.id}`}
        categories={categories.map((row) => ({ category: row.category, subcategory: row.subcategory }))}
        collections={[]}
        collectionName={collection.name}
        canMove={false}
        moveUnlocked={false}
        values={{
          collectionId: collection.id,
          title: "",
          category: "",
          subcategory: "",
          kind: "article",
          internalOnly: !collection.publicAccess ? false : true,
          body: "",
          steps: [],
          imported: false,
        }}
      />
  );
}
