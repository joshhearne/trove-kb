import { mergeAttributes, Node } from "@tiptap/core";
import { formatWikilink, type WikilinkKind } from "@/lib/wikilinks";

/**
 * A link to another page inside the visual editor: one piece, shown by its
 * label, read from and written back to Markdown as `[[doc:…|Label]]` exactly.
 * Without it the visual editor would see brackets in a paragraph and save them
 * escaped (`\[\[`), and the link would be lost.
 */

type MarkdownIt = {
  inline: { ruler: { before: (name: string, rule: string, fn: (state: InlineState, silent: boolean) => boolean) => void } };
  renderer: { rules: Record<string, (tokens: { meta: unknown }[], index: number) => string> };
};
type InlineState = { src: string; pos: number; posMax: number; push: (type: string, tag: string, nesting: number) => { meta: unknown } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Reads `[[target|label]]` where markdown-it reads inline text. */
function wikilinkRule(state: InlineState, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
  const close = state.src.indexOf("]]", state.pos + 2);
  if (close === -1 || close > state.posMax) return false;
  const inner = state.src.slice(state.pos + 2, close);
  if (inner === "" || inner.includes("\n") || inner.includes("[")) return false;
  const bar = inner.indexOf("|");
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const label = bar === -1 ? "" : inner.slice(bar + 1).trim();
  const byId = /^(doc|kb):(.+)$/i.exec(target);
  const meta =
    byId && UUID.test(byId[2]!)
      ? { kind: byId[1]!.toLowerCase(), id: byId[2]!.toLowerCase(), label }
      : { kind: "", id: "", label: label || target };
  if (!silent) state.push("wikilink", "span", 0).meta = meta;
  state.pos = close + 2;
  return true;
}

export const WikilinkNode = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: "", parseHTML: (element) => element.getAttribute("data-kind") ?? "" },
      id: { default: "", parseHTML: (element) => element.getAttribute("data-id") ?? "" },
      label: { default: "", parseHTML: (element) => element.getAttribute("data-label") ?? element.textContent ?? "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wikilink]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = String(node.attrs.label || (node.attrs.kind === "kb" ? "Article" : "Document"));
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-wikilink": "",
        "data-kind": node.attrs.kind,
        "data-id": node.attrs.id,
        "data-label": node.attrs.label,
        class: node.attrs.id ? "wikilink" : "wikilink wikilink-unmade",
      }),
      label,
    ];
  },

  renderText({ node }) {
    return String(node.attrs.label ?? "");
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void }, node: { attrs: { kind: string; id: string; label: string } }) {
          const { kind, id, label } = node.attrs;
          state.write(kind && id ? formatWikilink(kind as WikilinkKind, id, label) : `[[${label}]]`);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.inline.ruler.before("link", "wikilink", wikilinkRule);
            markdownit.renderer.rules.wikilink = (tokens, index) => {
              const meta = tokens[index]!.meta as { kind: string; id: string; label: string };
              return `<span data-wikilink data-kind="${escapeAttribute(meta.kind)}" data-id="${escapeAttribute(meta.id)}" data-label="${escapeAttribute(meta.label)}">${escapeAttribute(meta.label)}</span>`;
            };
          },
        },
      },
    };
  },
});
