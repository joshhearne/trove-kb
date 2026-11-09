"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Download, FileUp, History, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { recategorizeArticleAction, relocateArticleAction, removeArticleAction } from "./actions";

export type ManageHistoryRow = {
  id: number;
  action: "edited" | "replaced" | "moved" | "recategorized" | "removed" | "restored";
  who: string | null;
  when: string;
  detail: string | null;
  viewHref: string | null;
  fileHref: string | null;
};

export type ArticleManageProps = {
  articleId: string;
  collectionId: string;
  category: string;
  subcategory: string;
  /** Categories and sections the collection already uses. */
  categories: { category: string | null; subcategory: string | null }[];
  /** Every other collection it could move to. */
  collections: { id: string; name: string }[];
  /** For a text file, which is edited with Edit at the top of the article. */
  editHref: string | null;
  /** The file it came from, when it is kept. */
  downloadHref: string | null;
  history: ManageHistoryRow[];
};

const section = "flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0";
const heading = "text-sm font-medium";
const hint = "text-xs text-[var(--muted-foreground)]";

function Status({ state, ok }: { state: FormState; ok: string }) {
  if (state.error) return <FormError>{state.error}</FormError>;
  if (state.ok) return <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{ok}</p>;
  return null;
}

/**
 * An administrator's tools for one article, whatever it came from: file it,
 * move it, edit it (a text file) or replace its file (anything else), take it
 * out, and see what has been done to it.
 */
export function ArticleManage(props: ArticleManageProps) {
  const t = useMessages().kb.manage;
  const ids = { category: useId(), subcategory: useId(), collection: useId(), file: useId(), cats: useId(), subs: useId() };
  const [category, setCategory] = useState(props.category);
  const [placeState, placeAction, placing] = useActionState<FormState, FormData>(recategorizeArticleAction, {});
  const [moveState, moveAction, moving] = useActionState<FormState, FormData>(relocateArticleAction, {});
  const [upload, setUpload] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, startUpload] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const categoryNames = [...new Set(props.categories.map((row) => row.category).filter((name): name is string => !!name))];
  const sectionNames = [
    ...new Set(
      props.categories
        .filter((row) => row.category === category)
        .map((row) => row.subcategory)
        .filter((name): name is string => !!name),
    ),
  ];

  function sendFile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    startUpload(async () => {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/kb/articles/${props.articleId}/file`, { method: "POST", body });
      if (response.ok) {
        setUpload({ ok: true, text: t.uploaded });
        if (fileInput.current) fileInput.current.value = "";
        router.refresh();
      } else {
        const failure = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setUpload({ ok: false, text: failure?.error?.message ?? response.statusText });
      }
    });
  }

  return (
    <section id="manage" aria-labelledby="manage-title" className="flex scroll-mt-20 flex-col gap-4 rounded-lg border p-4">
      <div>
        <h2 id="manage-title" className="text-base font-semibold">{t.title}</h2>
        <p className={hint}>{t.hint}</p>
      </div>

      <form action={placeAction} className={section}>
        <input type="hidden" name="articleId" value={props.articleId} />
        <h3 className={heading}>{t.placement}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={ids.category} label={t.category} error={placeState.fieldErrors?.category}>
            <Input
              id={ids.category}
              name="category"
              list={ids.cats}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={200}
              placeholder={t.none}
            />
          </Field>
          <Field id={ids.subcategory} label={t.subcategory} error={placeState.fieldErrors?.subcategory}>
            <Input
              id={ids.subcategory}
              name="subcategory"
              list={ids.subs}
              defaultValue={props.subcategory}
              maxLength={200}
              placeholder={t.none}
              disabled={category.trim() === ""}
            />
          </Field>
          <datalist id={ids.cats}>{categoryNames.map((name) => <option key={name} value={name} />)}</datalist>
          <datalist id={ids.subs}>{sectionNames.map((name) => <option key={name} value={name} />)}</datalist>
        </div>
        <p className={hint}>{t.placementKept}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={placing}>{t.savePlacement}</Button>
          <Status state={placeState} ok={t.placementSaved} />
        </div>
      </form>

      <form action={moveAction} className={section}>
        <input type="hidden" name="articleId" value={props.articleId} />
        <h3 className={heading}>{t.move}</h3>
        <p className={hint}>{t.moveHint}</p>
        {props.collections.length === 0 ? (
          <p className={hint}>{t.noOtherCollections}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field id={ids.collection} label={t.moveTo}>
              <Select
                id={ids.collection}
                name="collectionId"
                defaultValue={props.collections[0]!.id}
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
              >
                {props.collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="outline" size="sm" disabled={moving}>{t.moveButton}</Button>
          </div>
        )}
        <Status state={moveState} ok={t.moved} />
      </form>

      <div className={section}>
        <h3 className={heading}>{t.file}</h3>
        <div className="flex flex-wrap items-center gap-3">
          {/* A text file is edited with Edit at the top of the article: one link, not two. */}
          {props.editHref && <p className={hint}>{t.editText}</p>}
          {props.downloadHref ? (
            <a
              href={props.downloadHref}
              download
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)]"
            >
              <Download className="size-4" aria-hidden />
              {t.download}
            </a>
          ) : (
            !props.editHref && <p className={hint}>{t.noFile}</p>
          )}
        </div>
        {!props.editHref && (
          <form onSubmit={sendFile} className="flex flex-col gap-2">
            <label htmlFor={ids.file} className="text-sm">{t.upload}</label>
            <p className={hint}>{t.uploadHint}</p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInput}
                id={ids.file}
                type="file"
                name="file"
                required
                accept=".pdf,.docx,.html,.htm,.md,.markdown,.txt"
                className="max-w-full text-sm"
              />
              <Button type="submit" variant="outline" size="sm" disabled={uploading}>
                <FileUp className="size-4" aria-hidden />
                {uploading ? t.uploading : t.uploadButton}
              </Button>
            </div>
            {upload &&
              (upload.ok ? (
                <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{upload.text}</p>
              ) : (
                <FormError>{upload.text}</FormError>
              ))}
          </form>
        )}
      </div>

      <form
        action={removeArticleAction}
        className={section}
        onSubmit={(event) => {
          if (!window.confirm(t.removeConfirm)) event.preventDefault();
        }}
      >
        <input type="hidden" name="articleId" value={props.articleId} />
        <input type="hidden" name="collectionId" value={props.collectionId} />
        <h3 className={heading}>{t.remove}</h3>
        <p className={hint}>{t.removeHint}</p>
        <div>
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 className="size-4" aria-hidden />
            {t.removeButton}
          </Button>
        </div>
      </form>

      <div className={section}>
        <h3 className={`${heading} inline-flex items-center gap-1.5`}>
          <History className="size-4" aria-hidden />
          {t.history}
        </h3>
        {props.history.length === 0 ? (
          <p className={hint}>{t.noHistory}</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {props.history.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{t.actions[row.action]}</span>
                {row.detail && <span className="text-[var(--muted-foreground)]">{row.detail}</span>}
                <span className="text-xs text-[var(--muted-foreground)]">
                  {row.when}
                  {row.who && ` · ${t.by(row.who)}`}
                </span>
                {row.viewHref && (
                  <Link href={row.viewHref as Route} className="text-xs underline">{t.view}</Link>
                )}
                {row.fileHref && (
                  <a href={row.fileHref} download className="text-xs underline">{t.previousFile}</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
