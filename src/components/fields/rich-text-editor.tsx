"use client";

import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState } from "react";
import { IndentDecrease, IndentIncrease, SquareArrowOutUpRight } from "lucide-react";
import { MarkdownWorkspace } from "@/components/markdown/markdown-workspace";
import { WikilinkPicker } from "@/components/markdown/wikilink-picker";
import { useWikilinkContext } from "@/components/markdown/wikilink-context";
import { WikilinkNode } from "@/components/fields/wikilink-node";
import type { WikilinkSuggestion } from "@/server/services/wikilinks";
import { cn } from "@/lib/utils";
import { useMessages } from "@/i18n/client";
import type { Messages } from "@/i18n/en-US";

/** tiptap-markdown adds this to editor.storage but ships no module augmentation. */
type MarkdownStorage = { markdown: { getMarkdown: () => string } };

type Mode = "markdown" | "richtext";

type Labels = Messages["documents"]["richText"];

type Tool = {
  key: keyof Labels;
  label: string;
  /** What `isActive` is asked about to light the button up. */
  mark: string;
  run: (editor: Editor) => void;
};

const TOOLS: readonly Tool[] = [
  { key: "bold", label: "B", mark: "bold", run: (e) => e.chain().focus().toggleBold().run() },
  { key: "italic", label: "I", mark: "italic", run: (e) => e.chain().focus().toggleItalic().run() },
  { key: "heading", label: "H2", mark: "heading", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { key: "quote", label: "“”", mark: "blockquote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { key: "bulletList", label: "• List", mark: "bulletList", run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: "numberedList", label: "1. List", mark: "orderedList", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: "taskList", label: "☑ List", mark: "taskList", run: (e) => e.chain().focus().toggleTaskList().run() },
  { key: "codeBlock", label: "</>", mark: "codeBlock", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  {
    key: "table",
    label: "▦ Table",
    mark: "table",
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

/** One level in or out, for the list item the cursor is in: plain, or a checklist's. */
const INDENT_TOOLS: readonly { key: "indent" | "outdent"; run: (editor: Editor) => void }[] = [
  {
    key: "outdent",
    run: (e) => {
      if (!e.chain().focus().liftListItem("listItem").run()) e.chain().focus().liftListItem("taskItem").run();
    },
  },
  {
    key: "indent",
    run: (e) => {
      if (!e.chain().focus().sinkListItem("listItem").run()) e.chain().focus().sinkListItem("taskItem").run();
    },
  },
];

/** Shown only while the cursor is inside a table. */
const TABLE_TOOLS: readonly { key: keyof Labels; run: (editor: Editor) => void }[] = [
  { key: "addRow", run: (e) => e.chain().focus().addRowAfter().run() },
  { key: "addColumn", run: (e) => e.chain().focus().addColumnAfter().run() },
  { key: "deleteRow", run: (e) => e.chain().focus().deleteRow().run() },
  { key: "deleteColumn", run: (e) => e.chain().focus().deleteColumn().run() },
  { key: "deleteTable", run: (e) => e.chain().focus().deleteTable().run() },
];

/**
 * One editor for both markdown and rich text fields, as the stack table asks.
 * The value travels in a hidden input so the form still works as a plain POST:
 * markdown fields serialize to markdown source, richtext fields to HTML that the
 * server sanitizes again on write.
 *
 * Text pasted in is read as Markdown, so a `.md` file pasted whole keeps its
 * headings, lists, tables, and checklists instead of arriving as literal `#`
 * and `|` characters. Shift+paste keeps it plain. A markdown field also offers
 * the source itself, for people who would rather write or paste it as text.
 */
export function RichTextEditor({
  name,
  mode,
  value,
  onChange,
  ariaLabelledBy,
}: {
  name: string;
  mode: Mode;
  /** Controlled by the form so structural edits never discard it. */
  value: string;
  onChange: (next: string) => void;
  ariaLabelledBy?: string;
}) {
  const t = useMessages();
  const labels = t.documents.richText;
  // Links to other pages, in a markdown field on a page that has a place to link from.
  const links = useWikilinkContext();
  const linking = mode === "markdown" && links !== null;
  const [picking, setPicking] = useState(false);
  // The editor's input handler is made once; it reads whether links apply from here.
  const linkingRef = useRef(linking);
  useEffect(() => {
    linkingRef.current = linking;
  }, [linking]);

  const editor = useEditor({
    // Rendering on the server would not match the client's ProseMirror output.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      // Keeps [[doc:…|…]] links whole in the visual view, and writes them back as written.
      ...(mode === "markdown" ? [WikilinkNode] : []),
      Markdown.configure({
        html: mode === "richtext",
        transformPastedText: true,
        transformCopiedText: mode === "markdown",
      }),
    ],
    // Seeded once; the editor owns the document from then on.
    content: value,
    editorProps: {
      attributes: {
        class: "prose-editor min-h-40 w-full px-3 py-2 outline-none",
        ...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {}),
      },
      // A second [ opens the list of pages to link, as it does in the source.
      handleTextInput: (view, from, to, text) => {
        if (!linkingRef.current || text !== "[" || from < 1) return false;
        if (view.state.doc.textBetween(from - 1, from) !== "[") return false;
        view.dispatch(view.state.tr.delete(from - 1, to));
        setPicking(true);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      // An empty document still serializes to "<p></p>"; store a blank instead.
      if (instance.isEmpty) {
        onChange("");
        return;
      }
      onChange(
        mode === "markdown"
          ? (instance.storage as unknown as MarkdownStorage).markdown.getMarkdown()
          : instance.getHTML(),
      );
    },
  });

  // Button states follow the selection; the editor itself does not re-render
  // this component on every keystroke.
  const active = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      marks: TOOLS.map((tool) => (instance ? instance.isActive(tool.mark) : false)),
      inTable: instance ? instance.isActive("table") : false,
      inList: instance ? instance.isActive("listItem") || instance.isActive("taskItem") : false,
    }),
  });

  /** Puts the picked page in at the cursor, labelled with the selected text or its title. */
  function insertPage(page: WikilinkSuggestion) {
    setPicking(false);
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, " ").trim();
    editor
      .chain()
      .focus()
      .insertContent({ type: "wikilink", attrs: { kind: page.kind, id: page.id, label: selected || page.title } })
      .run();
  }

  const toolbar = (
    <>
      {TOOLS.map((tool, index) => (
        <button
          key={tool.key}
          type="button"
          title={labels[tool.key]}
          aria-label={labels[tool.key]}
          aria-pressed={active?.marks[index] ?? false}
          onClick={() => editor && tool.run(editor)}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium hover:bg-[var(--muted)]",
            active?.marks[index] && "bg-[var(--muted)]",
          )}
        >
          {tool.label}
        </button>
      ))}
      <span className="flex items-center gap-0.5 border-l pl-1">
        {INDENT_TOOLS.map((tool) => {
          const Icon = tool.key === "indent" ? IndentIncrease : IndentDecrease;
          const label = t.markdownEditor.tools[tool.key];
          return (
            <button
              key={tool.key}
              type="button"
              title={label}
              aria-label={label}
              disabled={!active?.inList}
              onClick={() => editor && tool.run(editor)}
              className="rounded p-1.5 hover:bg-[var(--muted)] disabled:opacity-40"
            >
              <Icon className="size-4" aria-hidden />
            </button>
          );
        })}
      </span>
      {linking && (
        <button
          type="button"
          title={`${t.markdownEditor.links.button} (${t.markdownEditor.links.hint})`}
          aria-label={t.markdownEditor.links.button}
          aria-expanded={picking}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setPicking((open) => !open)}
          className="inline-flex items-center gap-1 rounded border-l px-2 py-1 text-xs hover:bg-[var(--muted)]"
        >
          <SquareArrowOutUpRight className="size-3.5" aria-hidden />
          [[ ]]
        </button>
      )}
      {active?.inTable && (
        <span className="flex flex-wrap items-center gap-1 border-l pl-1" role="group" aria-label={labels.table}>
          {TABLE_TOOLS.map((tool) => (
            <button
              key={tool.key}
              type="button"
              onClick={() => editor && tool.run(editor)}
              className="rounded px-2 py-1 text-xs hover:bg-[var(--muted)]"
            >
              {labels[tool.key]}
            </button>
          ))}
        </span>
      )}
    </>
  );

  // A markdown field: the visual editor, the source with its own toolbar, a
  // preview, and the two side by side on a wide screen.
  if (mode === "markdown") {
    return (
      <>
        <MarkdownWorkspace
          value={value}
          onChange={onChange}
          flavor="field"
          visual={
            <div className="relative">
              <EditorContent editor={editor} />
              {picking && links && (
                <WikilinkPicker
                  context={links}
                  onPick={insertPage}
                  onClose={() => {
                    setPicking(false);
                    editor?.commands.focus();
                  }}
                  className="absolute top-1 right-2"
                />
              )}
            </div>
          }
          visualToolbar={toolbar}
          // The source may have changed; the visual view starts from it again.
          // tiptap-markdown's setContent takes Markdown, so the source goes in as is.
          onShowVisual={() => editor?.commands.setContent(value)}
          ariaLabelledBy={ariaLabelledBy}
          placeholder={labels.sourceHint}
        />
        <input type="hidden" name={name} value={value} />
      </>
    );
  }

  return (
    <div className="rounded-md border focus-within:ring-2 focus-within:ring-[var(--ring)]">
      <div className="flex flex-wrap items-center gap-1 border-b p-1">{toolbar}</div>
      <EditorContent editor={editor} />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
