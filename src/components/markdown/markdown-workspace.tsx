"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Bold,
  Code,
  Columns2,
  Heading2,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  PanelRightClose,
  Quote,
  SquareArrowOutUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";
import type { Messages } from "@/i18n/en-US";
import { useEditorView } from "@/components/editor-view-context";
import {
  indentLines,
  insertLink,
  outdentLines,
  tabIndents,
  toggleLinePrefix,
  toggleWrap,
  type EditState,
} from "@/lib/markdown-edit";
import { previewMarkdownAction, type Preview as Drawn, type PreviewFlavor } from "@/app/markdown-preview-actions";
import type { WikilinkContext, WikilinkSuggestion } from "@/server/services/wikilinks";
import { formatWikilink, openWikilinkAt } from "@/lib/wikilinks";
import { caretOffset, WikilinkPicker, type WikilinkPickerHandle } from "@/components/markdown/wikilink-picker";
import { useWikilinkContext } from "@/components/markdown/wikilink-context";

/**
 * Where Markdown is written: the source with a toolbar of its own (indent and
 * outdent among it), a preview drawn by the server exactly as the saved page
 * is, and on a wide screen the two side by side, with a handle between them
 * to share the width and a button to fold the preview back into a tab.
 * A field with a visual editor passes it in, and it becomes the first tab.
 *
 * Opens the way the person chose in their menu (useEditorView); side by side
 * only where the screen is wide enough for it.
 */

type View = "visual" | "markdown" | "preview" | "split";

const WIDE = "(min-width: 1024px)";
const SPLIT_KEY = "trove-kb-editor-split";

function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

function readSplit(): number {
  try {
    const stored = Number(window.localStorage.getItem(SPLIT_KEY));
    return stored >= 0.25 && stored <= 0.75 ? stored : 0.5;
  } catch {
    return 0.5;
  }
}

/** The server's drawing of the source, a moment after typing stops. */
function Preview({
  source,
  flavor,
  links,
  className,
}: {
  source: string;
  flavor: PreviewFlavor;
  links?: WikilinkContext;
  className?: string;
}) {
  const t = useMessages().markdownEditor;
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const linksKey = links ? JSON.stringify(links) : "";
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      previewMarkdownAction(source, flavor, links)
        .then((result) => {
          if (!current) return;
          setDrawn(result);
          setFailed(false);
        })
        .catch(() => current && setFailed(true));
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
    // The context's contents, not its identity: a page may pass a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, flavor, linksKey]);

  // A link in the preview opens beside the editor, never in place of it.
  const openLinksElsewhere = (event: React.MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest("a");
    if (!link?.href) return;
    event.preventDefault();
    window.open(link.href, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={cn("overflow-auto px-3 py-2", className)} aria-live="polite" aria-busy={drawn === null}>
      {failed ? (
        <p className="text-sm text-[var(--destructive)]">{t.previewFailed}</p>
      ) : drawn === null ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t.previewLoading}</p>
      ) : drawn.html.trim() === "" ? (
        <p className="text-sm text-[var(--muted-foreground)]">{t.previewEmpty}</p>
      ) : (
        <div
          className="prose-editor kb-article min-w-0 text-sm break-words"
          onClick={openLinksElsewhere}
          dangerouslySetInnerHTML={{ __html: drawn.html }}
        />
      )}
      {drawn && drawn.flagged.length > 0 && (
        <div role="note" className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs">
          <p className="font-medium">{t.links.flaggedTitle}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {drawn.flagged.map((entry, index) => (
              <li key={index}>
                <span className="font-medium">{entry.title}</span>
                {": "}
                {entry.flags.map((flag) => t.links.flags[flag]).join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Labels = Messages["markdownEditor"];
type Tool = {
  key: keyof Labels["tools"];
  icon: typeof Bold;
  run: (state: EditState, placeholder: string) => EditState;
  shortcut?: string;
};

/** What a wrap or a link puts in when nothing is selected. */
function placeholderFor(labels: Labels, key: Tool["key"]): string {
  return key in labels.placeholders ? labels.placeholders[key as keyof Labels["placeholders"]] : "";
}

const TOOLS: Tool[] = [
  { key: "bold", icon: Bold, run: (state, text) => toggleWrap(state, "**", text), shortcut: "b" },
  { key: "italic", icon: Italic, run: (state, text) => toggleWrap(state, "_", text), shortcut: "i" },
  { key: "code", icon: Code, run: (state, text) => toggleWrap(state, "`", text) },
  { key: "heading", icon: Heading2, run: (state) => toggleLinePrefix(state, "heading") },
  { key: "bullet", icon: List, run: (state) => toggleLinePrefix(state, "bullet") },
  { key: "numbered", icon: ListOrdered, run: (state) => toggleLinePrefix(state, "numbered") },
  { key: "quote", icon: Quote, run: (state) => toggleLinePrefix(state, "quote") },
  { key: "link", icon: Link, run: (state, text) => insertLink(state, text), shortcut: "k" },
  { key: "outdent", icon: IndentDecrease, run: (state) => outdentLines(state) },
  { key: "indent", icon: IndentIncrease, run: (state) => indentLines(state) },
];

export function MarkdownWorkspace({
  value,
  onChange,
  flavor,
  visual,
  visualToolbar,
  onShowVisual,
  textareaId,
  ariaLabelledBy,
  placeholder,
  invalid,
  minHeightClass = "min-h-40",
  monoClass = "font-mono text-xs",
  links: linksProp,
}: {
  value: string;
  onChange: (next: string) => void;
  /** How the preview is drawn: as a document field, or as a knowledge base article. */
  flavor: PreviewFlavor;
  /** The visual editor, with its own toolbar, for a field that has one. */
  visual?: ReactNode;
  /** The visual editor's toolbar, drawn in the header while it is shown. */
  visualToolbar?: ReactNode;
  /** Called as the visual tab is shown, so it can take up the source again. */
  onShowVisual?: () => void;
  textareaId?: string;
  ariaLabelledBy?: string;
  placeholder?: string;
  invalid?: boolean;
  minHeightClass?: string;
  monoClass?: string;
  /** Where the text is being written: given, [[ links pages, and the preview flags links some readers cannot open. */
  links?: WikilinkContext;
}) {
  const t = useMessages().markdownEditor;
  const fromPage = useWikilinkContext();
  const links = linksProp ?? fromPage ?? undefined;
  const preference = useEditorView();
  const wide = useWide();
  // "Split" falls back to Markdown below (`shown`) wherever the screen is narrow.
  const [view, setView] = useState<View>(() =>
    preference === "split" ? "split" : preference === "visual" && visual ? "visual" : "markdown",
  );
  // The split is only ever drawn in the browser, so the remembered width can be read at once.
  const [ratio, setRatio] = useState(() => (typeof window === "undefined" ? 0.5 : readSplit()));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const previewId = useId();
  const picker = useRef<WikilinkPickerHandle>(null);
  // The link being typed at the caret, and where to show the list for it.
  const [typing, setTyping] = useState<{ from: number; to: number; query: string; top: number; left: number } | null>(null);
  // The list opened from the toolbar, with a search box of its own.
  const [searching, setSearching] = useState(false);

  /** Opens, moves or closes the list as the caret moves in and out of a [[ being typed. */
  function followCaret(element: HTMLTextAreaElement, text: string) {
    if (!links || element.selectionStart !== element.selectionEnd) {
      setTyping(null);
      return;
    }
    const open = openWikilinkAt(text, element.selectionStart);
    if (!open) {
      setTyping(null);
      return;
    }
    const at = caretOffset(element, open.from);
    setTyping({ ...open, top: at.top + element.offsetTop, left: at.left + element.offsetLeft });
  }

  /** Writes the picked page in: over the [[ being typed, or at the caret, around any selected text. */
  function insertPage(page: WikilinkSuggestion) {
    const element = textarea.current;
    const range = typing ?? (element ? { from: element.selectionStart, to: element.selectionEnd } : { from: value.length, to: value.length });
    const selected = typing ? "" : value.slice(range.from, range.to);
    const link = formatWikilink(page.kind, page.id, selected.trim() || page.title);
    const next = value.slice(0, range.from) + link + value.slice(range.to);
    const caret = range.from + link.length;
    pending.current = { start: caret, end: caret };
    setTyping(null);
    setSearching(false);
    onChange(next);
    element?.focus();
  }

  const shown: View = view === "split" && !wide ? "markdown" : view;
  const sourceShown = shown === "markdown" || shown === "split";

  // The selection goes back where the edit left it, once React has drawn the new text.
  useEffect(() => {
    const element = textarea.current;
    if (!pending.current || !element) return;
    element.setSelectionRange(pending.current.start, pending.current.end);
    pending.current = null;
  }, [value]);

  const apply = useCallback(
    (edit: (state: EditState) => EditState) => {
      const element = textarea.current;
      if (!element) return;
      const next = edit({ value, start: element.selectionStart, end: element.selectionEnd });
      pending.current = { start: next.start, end: next.end };
      onChange(next.value);
      element.focus();
    },
    [value, onChange],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const element = event.currentTarget;
    const state = { value, start: element.selectionStart, end: element.selectionEnd };
    // While a link is being typed, the list takes the arrows, Enter, Tab and Escape.
    if (typing && picker.current?.handleKey(event)) {
      if (event.key === "Escape") setTyping(null);
      return;
    }
    // A second [ closes the link at once, with the caret between, as notebooks do.
    if (links && event.key === "[" && state.start === state.end && value[state.start - 1] === "[" && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      apply((current) => ({
        value: current.value.slice(0, current.start) + "[]]" + current.value.slice(current.end),
        start: current.start + 1,
        end: current.start + 1,
      }));
      return;
    }
    // Tab indents in a list or across lines; anywhere else it moves on, as it should.
    if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey && tabIndents(state)) {
      event.preventDefault();
      apply(event.shiftKey ? outdentLines : indentLines);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const tool = TOOLS.find((candidate) => candidate.shortcut === event.key.toLowerCase());
      if (tool && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        apply((current) => tool.run(current, placeholderFor(t, tool.key)));
      }
    }
  }

  function show(next: View) {
    if (next === "visual") onShowVisual?.();
    setView(next);
  }

  function saveRatio(next: number) {
    const clamped = Math.min(0.75, Math.max(0.25, next));
    setRatio(clamped);
    try {
      window.localStorage.setItem(SPLIT_KEY, String(clamped));
    } catch {
      // Remembering the width is a convenience only.
    }
  }

  function drag(event: React.PointerEvent<HTMLDivElement>) {
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => {
      const box = pane.current?.getBoundingClientRect();
      if (box && box.width > 0) saveRatio((moved.clientX - box.left) / box.width);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  const tabs: { view: View; label: string }[] = [
    ...(visual ? [{ view: "visual" as const, label: t.visual }] : []),
    { view: "markdown", label: t.markdown },
    { view: "preview", label: t.preview },
  ];

  const source = (
    <textarea
      ref={textarea}
      id={textareaId}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
        followCaret(event.target, event.target.value);
      }}
      onSelect={(event) => followCaret(event.currentTarget, event.currentTarget.value)}
      onBlur={() => setTyping(null)}
      onKeyDown={onKeyDown}
      aria-labelledby={ariaLabelledBy}
      aria-invalid={invalid || undefined}
      spellCheck
      placeholder={placeholder}
      className={cn(
        "block w-full resize-y bg-transparent px-3 py-2 outline-none",
        monoClass,
        shown === "split" ? "h-full min-h-[60vh] resize-none" : minHeightClass,
      )}
    />
  );

  const pickers = links ? (
    <>
      {typing && (
        <WikilinkPicker
          ref={picker}
          context={links}
          query={typing.query}
          onPick={insertPage}
          onClose={() => setTyping(null)}
          className="absolute"
          style={{ top: typing.top, left: typing.left }}
        />
      )}
      {searching && !typing && (
        <WikilinkPicker
          context={links}
          onPick={insertPage}
          onClose={() => setSearching(false)}
          className="absolute top-1 right-2"
        />
      )}
    </>
  ) : null;

  return (
    <div
      className={cn("rounded-md border focus-within:ring-2 focus-within:ring-[var(--ring)]", invalid && "border-[var(--destructive)]")}
      data-md-split={shown === "split" ? "" : undefined}
    >
      <div className="flex flex-wrap items-center gap-1 border-b p-1">
        {sourceShown &&
          TOOLS.map((tool) => {
            const Icon = tool.icon;
            const label = t.tools[tool.key];
            return (
              <button
                key={tool.key}
                type="button"
                title={tool.shortcut ? `${label} (Ctrl+${tool.shortcut.toUpperCase()})` : label}
                aria-label={label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply((state) => tool.run(state, placeholderFor(t, tool.key)))}
                className={cn(
                  "rounded p-1.5 hover:bg-[var(--muted)]",
                  tool.key === "outdent" && "ml-1 border-l pl-2",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </button>
            );
          })}
        {sourceShown && links && (
          <button
            type="button"
            title={`${t.links.button} (${t.links.hint})`}
            aria-label={t.links.button}
            aria-expanded={searching}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setSearching((open) => !open)}
            className="ml-1 inline-flex items-center gap-1 rounded border-l px-2 py-1 text-xs hover:bg-[var(--muted)]"
          >
            <SquareArrowOutUpRight className="size-3.5" aria-hidden />
            [[ ]]
          </button>
        )}
        {shown === "visual" && visualToolbar}
        <span className="ml-auto flex items-center gap-1">
          {wide && shown === "markdown" && (
            <button
              type="button"
              onClick={() => show("split")}
              title={t.showBeside}
              aria-label={t.showBeside}
              className="rounded p-1.5 hover:bg-[var(--muted)]"
            >
              <Columns2 className="size-4" aria-hidden />
            </button>
          )}
          <span role="group" aria-label={t.view} className="flex items-center gap-0.5 rounded-md border p-0.5 text-xs">
            {tabs.map((tab) => {
              const active = shown === tab.view || (tab.view === "markdown" && shown === "split");
              return (
                <button
                  key={tab.view}
                  type="button"
                  aria-pressed={active}
                  onClick={() => show(tab.view)}
                  className={cn(
                    "rounded px-2 py-0.5 font-medium hover:bg-[var(--muted)]",
                    active && "bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </span>
        </span>
      </div>

      {visual && <div className={cn(shown !== "visual" && "hidden")}>{visual}</div>}

      {shown === "markdown" && <div className="relative">{source}{pickers}</div>}

      {shown === "preview" && (
        <div>
          {wide && (
            <div className="flex justify-end border-b px-2 py-1">
              <button
                type="button"
                onClick={() => show("split")}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-[var(--muted)]"
              >
                <Columns2 className="size-3.5" aria-hidden />
                {t.showBeside}
              </button>
            </div>
          )}
          <Preview source={value} flavor={flavor} links={links} className={minHeightClass} />
        </div>
      )}

      {shown === "split" && (
        <div ref={pane} className="flex h-[70vh] min-h-96">
          <div className="relative min-w-0" style={{ width: `${ratio * 100}%` }}>
            {source}
            {pickers}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t.resize}
            aria-controls={previewId}
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            onPointerDown={drag}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") saveRatio(ratio - 0.05);
              else if (event.key === "ArrowRight") saveRatio(ratio + 0.05);
              else return;
              event.preventDefault();
            }}
            className="group flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center border-x bg-[var(--muted)] outline-none hover:bg-[var(--border)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <span className="h-8 w-0.5 rounded bg-[var(--muted-foreground)] opacity-50 group-hover:opacity-100" aria-hidden />
          </div>
          <div id={previewId} className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-[var(--muted-foreground)]">
              <span className="font-medium">{t.livePreview}</span>
              <button
                type="button"
                onClick={() => show("preview")}
                title={t.undock}
                aria-label={t.undock}
                className="rounded p-1 hover:bg-[var(--muted)]"
              >
                <PanelRightClose className="size-4" aria-hidden />
              </button>
            </div>
            <Preview source={value} flavor={flavor} links={links} className="flex-1" />
          </div>
        </div>
      )}
    </div>
  );
}
