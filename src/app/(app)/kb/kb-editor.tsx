"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useId, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/alert";
import { useMessages } from "@/i18n/client";
import type { FormState } from "@/lib/form";
import { deriveRunbook, RunbookStepError, type RunbookStep } from "@/server/kb/runbook";
import { collectionCategoriesAction, saveArticleAction, unlockMoveAction } from "./actions";

export type Category = { category: string | null; subcategory: string | null };

export type EditorValues = {
  /** The article being edited, when one is. */
  articleId?: string;
  collectionId: string;
  /** Set when editing; the article keeps its name across saves. */
  externalId?: string;
  title: string;
  category: string;
  subcategory: string;
  kind: "article" | "runbook";
  internalOnly: boolean;
  body: string;
  steps: RunbookStep[];
  /** Came from an import, so the next import of it wins. */
  imported: boolean;
};

const NEW = "\u0000new";

/**
 * A value chosen from what the collection already uses, or typed fresh: a
 * dropdown of the known names with "New…" at the end, which opens a box.
 */
function ComboField({
  id,
  name,
  label,
  options,
  value,
  onChange,
  newLabel,
  noneLabel,
}: {
  id: string;
  name: string;
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  newLabel: string;
  noneLabel: string;
}) {
  const t = useMessages().kb.editor;
  const known = options.includes(value);
  const [typing, setTyping] = useState(value !== "" && !known);
  const selectClass =
    "h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

  return (
    <Field id={id} label={label}>
      {typing ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            name={name}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={newLabel}
            maxLength={200}
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setTyping(false);
              onChange("");
            }}
          >
            {t.cancel}
          </Button>
        </div>
      ) : (
        <Select
          id={id}
          name={name}
          value={value}
          onChange={(event) => {
            if (event.target.value === NEW) {
              onChange("");
              setTyping(true);
            } else onChange(event.target.value);
          }}
          className={selectClass}
        >
          <option value="">{noneLabel}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value={NEW}>{t.newValue}</option>
        </Select>
      )}
    </Field>
  );
}

/**
 * The Markdown editor for a knowledge base article: the same fields a key
 * writes through the API, with category and section chosen from what the
 * collection already uses, and for a runbook the steps as a save would keep
 * them, read from the body as it is typed. An administrator can move the
 * article to another collection from here, with the second step fresh.
 */
export function KbEditor({
  values,
  backHref,
  categories: initialCategories,
  collections,
  collectionName,
  canMove,
  moveUnlocked,
  textOnly = false,
}: {
  values: EditorValues;
  backHref: string;
  /** What the article's collection already uses. */
  categories: Category[];
  /** Collections the person may write to, for moving. */
  collections: { id: string; name: string }[];
  collectionName: string;
  /** An administrator; moving is theirs to do once unlocked. */
  canMove: boolean;
  /** An imported text file: its text and place change, nothing else. */
  textOnly?: boolean;
  /** The second step is fresh, so the move dialog opens. */
  moveUnlocked: boolean;
}) {
  const messages = useMessages();
  const t = messages.kb.editor;
  const ids = { title: useId(), category: useId(), subcategory: useId(), body: useId(), collection: useId() };
  const [body, setBody] = useState(values.body);
  const [runbook, setRunbook] = useState(values.kind === "runbook");
  const [category, setCategory] = useState(values.category);
  const [subcategory, setSubcategory] = useState(values.subcategory);
  const [categories, setCategories] = useState(initialCategories);
  const [collectionId, setCollectionId] = useState(values.collectionId);
  const [chosenCollection, setChosenCollection] = useState(values.collectionId);
  const [loading, startLoading] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveArticleAction, {});

  const categoryNames = useMemo(
    () => [...new Set(categories.map((row) => row.category).filter((name): name is string => !!name))].sort(),
    [categories],
  );
  const sectionNames = useMemo(
    () =>
      [
        ...new Set(
          categories
            .filter((row) => (category ? row.category === category : true))
            .map((row) => row.subcategory)
            .filter((name): name is string => !!name),
        ),
      ].sort(),
    [categories, category],
  );

  const preview = useMemo(() => {
    if (!runbook) return null;
    try {
      return { steps: deriveRunbook(body, values.steps).steps, error: null };
    } catch (error) {
      return { steps: [], error: error instanceof RunbookStepError ? error.message : String(error) };
    }
  }, [runbook, body, values.steps]);

  const targetName = collections.find((row) => row.id === collectionId)?.name ?? collectionName;
  const moving = values.articleId !== undefined && collectionId !== values.collectionId;

  // The move itself happens on save; here the editor turns to face the new collection.
  const confirmMove = () => {
    const next = chosenCollection;
    dialog.current?.close();
    if (next === collectionId) return;
    startLoading(async () => {
      const rows = await collectionCategoriesAction(next);
      setCollectionId(next);
      setCategories(rows);
      setCategory("");
      setSubcategory("");
    });
  };

  return (
    <form action={formAction} className="flex max-w-4xl flex-col gap-5">
      <input type="hidden" name="collectionId" value={collectionId} />
      {values.articleId && <input type="hidden" name="articleId" value={values.articleId} />}
      {values.articleId && <input type="hidden" name="fromCollectionId" value={values.collectionId} />}
      {values.externalId && <input type="hidden" name="externalId" value={values.externalId} />}

      {values.imported && (
        <p role="note" className="rounded-md border px-3 py-2 text-sm text-[var(--muted-foreground)]">
          {textOnly ? t.importedTextNote : t.importedNote}
        </p>
      )}

      {values.articleId && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
          <div className="min-w-0 flex-1 text-sm">
            <span className="text-[var(--muted-foreground)]">{t.collection}: </span>
            <span className="font-medium">{targetName}</span>
            {moving && (
              <span className="ml-2 text-xs text-[var(--muted-foreground)]">{t.movePending(targetName)}</span>
            )}
          </div>
          {canMove ? (
            moveUnlocked ? (
              <Button type="button" variant="outline" size="sm" onClick={() => dialog.current?.showModal()}>
                {t.move}
              </Button>
            ) : (
              <Button type="submit" variant="outline" size="sm" formAction={unlockMoveAction} title={t.moveLocked}>
                {t.moveUnlock}
              </Button>
            )
          ) : (
            <span className="text-xs text-[var(--muted-foreground)]">{t.moveOnlyAdmins}</span>
          )}
        </div>
      )}

      <Field id={ids.title} label={t.title} error={state.fieldErrors?.title}>
        <Input id={ids.title} name="title" defaultValue={values.title} required maxLength={500} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <ComboField
          id={ids.category}
          name="category"
          label={t.category}
          options={categoryNames}
          value={category}
          onChange={(next) => {
            setCategory(next);
            setSubcategory("");
          }}
          newLabel={t.newCategory}
          noneLabel={t.noCategory}
        />
        <ComboField
          id={ids.subcategory}
          name="subcategory"
          label={t.subcategory}
          options={sectionNames}
          value={subcategory}
          onChange={setSubcategory}
          newLabel={t.newSection}
          noneLabel={t.noSection}
        />
      </div>

      {!textOnly && (
      <>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="runbook"
          checked={runbook}
          onChange={(event) => setRunbook(event.target.checked)}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        <span>
          <span className="block font-medium">{t.runbook}</span>
          <span className="block text-xs text-[var(--muted-foreground)]">{t.runbookHint}</span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="internalOnly"
          defaultChecked={values.internalOnly}
          className="mt-0.5 size-4 accent-[var(--primary)]"
        />
        <span>
          <span className="block font-medium">{t.internalOnly}</span>
          <span className="block text-xs text-[var(--muted-foreground)]">{t.internalOnlyHint}</span>
        </span>
      </label>
      </>
      )}

      <Field id={ids.body} label={t.body} hint={t.bodyHint} error={state.fieldErrors?.body ?? preview?.error ?? undefined}>
        <Textarea
          id={ids.body}
          name="body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          spellCheck
          className="min-h-96 font-mono text-sm"
          aria-invalid={!!state.fieldErrors?.body || !!preview?.error}
        />
      </Field>

      {preview && (
        <section aria-label={t.stepsPreview} className="rounded-md border px-4 py-3">
          <h2 className="text-sm font-medium">{t.stepsPreview}</h2>
          {preview.steps.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t.noSteps}</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-1 text-sm">
              {preview.steps.map((step, index) => (
                <li key={step.id} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-[var(--muted-foreground)]">{index + 1}.</span>
                  <span className="min-w-0 flex-1 break-words">
                    {step.text}{" "}
                    <code className="text-xs text-[var(--muted-foreground)]">{`{#${step.id}}`}</code>
                    {step.note && (
                      <span className="block text-xs text-[var(--muted-foreground)]">
                        {t.stepNote}: {step.note.split("\n")[0]}
                        {step.note.includes("\n") ? "…" : ""}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <FormError>{state.error}</FormError>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || loading || !!preview?.error}>
          {t.save}
        </Button>
        <Link href={backHref as Route} className="text-sm underline">
          {t.cancel}
        </Link>
      </div>

      <dialog
        ref={dialog}
        aria-label={t.moveTitle}
        className="m-auto w-full max-w-md rounded-lg border bg-[var(--card)] p-5 text-[var(--foreground)] shadow-lg backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold">{t.moveTitle}</h2>
            <p className="text-sm text-[var(--muted-foreground)]">{t.moveHint}</p>
          </div>
          <Field id={ids.collection} label={t.moveTo}>
            <Select
              id={ids.collection}
              value={chosenCollection}
              onChange={(event) => setChosenCollection(event.target.value)}
              className="h-10 w-full rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              {collections.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => dialog.current?.close()}>
              {messages.common.cancel}
            </Button>
            <Button type="button" size="sm" onClick={confirmMove}>
              {t.moveConfirm}
            </Button>
          </div>
        </div>
      </dialog>
    </form>
  );
}
