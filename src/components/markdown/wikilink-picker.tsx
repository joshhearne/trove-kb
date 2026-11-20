"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AlertTriangle, BookOpen, FilePlus2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";
import { createWikilinkAction, suggestWikilinksAction } from "@/app/wikilink-actions";
import type { WikilinkContext, WikilinkSuggestion } from "@/server/services/wikilinks";

/**
 * The list of pages offered as a link is typed: documents and articles whose
 * title holds what was typed, each with the caveats of linking to it, and
 * at the end "Create …" for a page not written yet. Driven by the editor's
 * own text (`query`) as `[[` is typed, or by a search box of its own when
 * opened from the toolbar.
 */

export type WikilinkPickerHandle = {
  /** Lets the picker take a key pressed in the editor. True when it did. */
  handleKey: (event: React.KeyboardEvent) => boolean;
};

type Item = { type: "page"; page: WikilinkSuggestion } | { type: "create"; title: string };

export const WikilinkPicker = forwardRef<
  WikilinkPickerHandle,
  {
    context: WikilinkContext;
    /** What has been typed in the editor; absent, the picker has its own search box. */
    query?: string;
    onPick: (page: WikilinkSuggestion) => void;
    onClose: () => void;
    style?: React.CSSProperties;
    className?: string;
  }
>(function WikilinkPicker({ context, query, onPick, onClose, style, className }, ref) {
  const t = useMessages().markdownEditor.links;
  const own = query === undefined;
  const [typed, setTyped] = useState("");
  const search = own ? typed : query;
  const [pages, setPages] = useState<WikilinkSuggestion[] | null>(null);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (own) input.current?.focus();
  }, [own]);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      suggestWikilinksAction(search, context)
        .then((found) => {
          if (!current) return;
          setPages(found);
          setActive(0);
        })
        .catch(() => current && setPages([]));
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [search, context]);

  const title = search.trim();
  const exact = pages?.some((page) => page.title.trim().toLowerCase() === title.toLowerCase()) ?? false;
  const items: Item[] = [
    ...(pages ?? []).map((page) => ({ type: "page" as const, page })),
    ...(title && !exact ? [{ type: "create" as const, title }] : []),
  ];

  async function choose(item: Item | undefined) {
    if (!item || creating) return;
    if (item.type === "page") {
      onPick(item.page);
      return;
    }
    setCreating(true);
    setError(null);
    const result = await createWikilinkAction(item.title, context).catch(() => null);
    setCreating(false);
    if (result?.ok) onPick(result.page);
    else setError(result?.error ?? t.none);
  }

  function handleKey(event: React.KeyboardEvent): boolean {
    if (event.key === "ArrowDown") {
      setActive((at) => Math.min(items.length - 1, at + 1));
    } else if (event.key === "ArrowUp") {
      setActive((at) => Math.max(0, at - 1));
    } else if ((event.key === "Enter" || event.key === "Tab") && items.length > 0) {
      void choose(items[active]);
    } else if (event.key === "Escape") {
      onClose();
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  }

  useImperativeHandle(ref, () => ({ handleKey }));

  const docs = items.filter((item) => item.type === "page" && item.page.kind === "doc");
  const articles = items.filter((item) => item.type === "page" && item.page.kind === "kb");

  const row = (item: Item) => {
    const index = items.indexOf(item);
    const selected = index === active;
    if (item.type === "create") {
      return (
        <li key="create" role="option" aria-selected={selected}>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => void choose(item)}
            className={cn("flex w-full items-start gap-2 rounded px-2 py-1.5 text-left", selected && "bg-[var(--muted)]")}
          >
            <FilePlus2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0">
              <span className="block font-medium break-words">{creating ? t.creating : t.create(item.title)}</span>
              <span className="block text-xs text-[var(--muted-foreground)]">
                {context.kind === "document" ? t.createDocument : t.createArticle}. {t.createHint}
              </span>
            </span>
          </button>
        </li>
      );
    }
    const Icon = item.page.kind === "doc" ? FileText : BookOpen;
    return (
      <li key={`${item.page.kind}:${item.page.id}`} role="option" aria-selected={selected}>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(index)}
          onClick={() => void choose(item)}
          title={item.page.flags.map((flag) => t.flags[flag]).join(" ") || undefined}
          className={cn("flex w-full items-start gap-2 rounded px-2 py-1.5 text-left", selected && "bg-[var(--muted)]")}
        >
          <Icon className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block break-words">{item.page.title}</span>
            <span className="block text-xs text-[var(--muted-foreground)]">{item.page.where}</span>
          </span>
          {item.page.flags.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="size-3" aria-hidden />
              {item.page.flags.map((flag) => t.flagShort[flag]).join(", ")}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div
      style={style}
      className={cn(
        "z-30 flex w-96 max-w-[calc(100vw-2rem)] flex-col rounded-md border bg-[var(--card)] text-sm shadow-lg",
        className,
      )}
      onKeyDown={own ? (event) => handleKey(event) : undefined}
    >
      {own && (
        <input
          ref={input}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={(event) => {
            if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) onClose();
          }}
          placeholder={t.search}
          aria-label={t.search}
          className="border-b bg-transparent px-3 py-2 outline-none"
        />
      )}
      <ul role="listbox" aria-label={t.search} className="max-h-72 overflow-y-auto p-1">
        {pages === null ? (
          <li className="px-2 py-1.5 text-[var(--muted-foreground)]">{t.searching}</li>
        ) : items.length === 0 ? (
          <li className="px-2 py-1.5 text-[var(--muted-foreground)]">{title ? t.none : t.typeToSearch}</li>
        ) : (
          <>
            {docs.length > 0 && <li className="px-2 pt-1 text-xs font-medium text-[var(--muted-foreground)]">{t.documents}</li>}
            {docs.map(row)}
            {articles.length > 0 && <li className="px-2 pt-1 text-xs font-medium text-[var(--muted-foreground)]">{t.articles}</li>}
            {articles.map(row)}
            {items.filter((item) => item.type === "create").map(row)}
          </>
        )}
      </ul>
      {error && <p className="border-t px-3 py-2 text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  );
});

/**
 * Where the caret sits in a textarea, from its top-left corner: a hidden copy
 * of the textarea, styled alike, with a marker where the caret is.
 */
export function caretOffset(textarea: HTMLTextAreaElement, position: number): { top: number; left: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  for (const property of [
    "boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth",
    "tabSize", "textIndent", "wordSpacing",
  ] as const) {
    mirror.style[property] = style[property];
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop - textarea.scrollTop + parseFloat(style.lineHeight || "16");
  const left = Math.min(marker.offsetLeft - textarea.scrollLeft, textarea.clientWidth - 40);
  document.body.removeChild(mirror);
  return { top, left: Math.max(0, left) };
}
