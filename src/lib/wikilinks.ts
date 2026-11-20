/**
 * Links between pages, written the way second-brain notebooks write them:
 *
 *     [[doc:3f9a…|Server room switch]]     a document
 *     [[kb:8c21…|Reset a user password]]   a knowledge base article
 *
 * The target comes first and is the page's id, so a link survives the page
 * being renamed or moved; the label after the bar is what the author wrote.
 * A link typed by hand with only a name, `[[Server room switch]]`, names no
 * page: it is drawn as text, marked as a link still to be made.
 *
 * Nothing here reads the database. Whoever draws a page resolves the ids it
 * links to for the person reading (`WikilinkIndex`), and a link to a page
 * that reader cannot open is drawn as its label alone: out of scope is not
 * found, so it is never a link, and its current title is never shown.
 */

export type WikilinkKind = "doc" | "kb";

export type Wikilink = {
  /** Where it sits in the text, and how long it is. */
  start: number;
  end: number;
  kind: WikilinkKind | null;
  /** The page's id; null for a link that only names a page. */
  id: string | null;
  /** What the author wrote after the bar, or the name of an unmade link. */
  label: string;
};

/** A page a link points at, as the reader may see it. */
export type WikilinkTarget = {
  /** Where the reader opens it; null when they may not. */
  href: string | null;
  /** Its title now, for a link written without a label. */
  title: string;
};

export type WikilinkIndex = Map<string, WikilinkTarget>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LINK = new RegExp(`\\[\\[(?:(doc|kb):(${UUID})(?:\\|([^\\]\\n]*))?|([^\\]|\\n:][^\\]|\\n]*?)(?:\\|([^\\]\\n]*))?)\\]\\]`, "gi");

/** Where fenced and inline code sit, which never holds links. */
function codeSpans(markdown: string): [number, number][] {
  const spans: [number, number][] = [];
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm;
  for (const match of markdown.matchAll(fence)) spans.push([match.index, match.index + match[0].length]);
  const inline = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
  for (const match of markdown.matchAll(inline)) {
    const start = match.index;
    if (!spans.some(([from, to]) => start >= from && start < to)) spans.push([start, start + match[0].length]);
  }
  return spans;
}

export function keyOf(kind: WikilinkKind, id: string): string {
  return `${kind}:${id.toLowerCase()}`;
}

/** Every link in the text, outside code, in order. */
export function parseWikilinks(markdown: string): Wikilink[] {
  if (!markdown.includes("[[")) return [];
  const code = codeSpans(markdown);
  const links: Wikilink[] = [];
  for (const match of markdown.matchAll(LINK)) {
    const start = match.index;
    if (code.some(([from, to]) => start >= from && start < to)) continue;
    const kind = (match[1]?.toLowerCase() as WikilinkKind | undefined) ?? null;
    links.push({
      start,
      end: start + match[0].length,
      kind,
      id: match[2]?.toLowerCase() ?? null,
      label: (kind ? match[3] : (match[5] ?? match[4]))?.trim() ?? "",
    });
  }
  return links;
}

/** The pages a text links to, each once. */
export function wikilinkTargets(markdown: string): { kind: WikilinkKind; id: string }[] {
  const seen = new Set<string>();
  const targets: { kind: WikilinkKind; id: string }[] = [];
  for (const link of parseWikilinks(markdown)) {
    if (!link.kind || !link.id) continue;
    const key = keyOf(link.kind, link.id);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ kind: link.kind, id: link.id });
  }
  return targets;
}

/** Characters that would end a Markdown link's text early. */
function escapeLabel(label: string): string {
  return label.replace(/([\\[\]*_`<>])/g, "\\$1");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The text with each link written as Markdown: a link where the reader may
 * open the page, its label alone (marked `wikilink-missing`) where they may
 * not or it is gone, and a link that only names a page marked
 * `wikilink-unmade`. With no index, every link is its label: never a link to
 * a page nobody checked.
 */
export function applyWikilinks(markdown: string, index: WikilinkIndex = new Map()): string {
  const links = parseWikilinks(markdown);
  if (links.length === 0) return markdown;
  let out = "";
  let at = 0;
  for (const link of links) {
    out += markdown.slice(at, link.start);
    at = link.end;
    if (!link.kind || !link.id) {
      out += `<span class="wikilink wikilink-unmade">${escapeHtml(link.label)}</span>`;
      continue;
    }
    const target = index.get(keyOf(link.kind, link.id));
    if (target?.href) {
      const label = link.label || target.title;
      out += `[${escapeLabel(label)}](${target.href})`;
    } else {
      out += `<span class="wikilink wikilink-missing">${escapeHtml(link.label || "…")}</span>`;
    }
  }
  return out + markdown.slice(at);
}

/** The text with each link as its label alone, for search and for plain text. */
export function wikilinkLabels(markdown: string, index: WikilinkIndex = new Map()): string {
  const links = parseWikilinks(markdown);
  if (links.length === 0) return markdown;
  let out = "";
  let at = 0;
  for (const link of links) {
    out += markdown.slice(at, link.start);
    at = link.end;
    const target = link.kind && link.id ? index.get(keyOf(link.kind, link.id)) : undefined;
    out += link.label || (target?.href ? target.title : "");
  }
  return out + markdown.slice(at);
}

/** How a picked page is written into the text. */
export function formatWikilink(kind: WikilinkKind, id: string, label: string): string {
  const clean = label.replace(/[\]\n|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? `[[${kind}:${id}|${clean}]]` : `[[${kind}:${id}]]`;
}

/**
 * The link being typed at the caret: an opening `[[` before it on the same
 * line with no `]]` or bar between, and what has been typed since. Null when
 * the caret is not inside one.
 */
export function openWikilinkAt(value: string, caret: number): { from: number; to: number; query: string } | null {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const before = value.slice(lineStart, caret);
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const typed = before.slice(open + 2);
  if (typed.includes("]") || typed.includes("|") || typed.includes("[")) return null;
  // A link already made (doc:… or kb:…) is not being typed.
  if (/^(?:doc|kb):/i.test(typed)) return null;
  const from = lineStart + open;
  // The closing brackets typed with the opening ones, if they are there.
  const to = value.startsWith("]]", caret) ? caret + 2 : caret;
  return { from, to, query: typed };
}

/**
 * The text with each link as an ordinary Markdown link to an address the
 * reader can open, or its label alone where there is none: for a file read
 * away from the site, by tools that know nothing of [[…]].
 */
export function wikilinksToMarkdown(markdown: string, index: WikilinkIndex = new Map()): string {
  const links = parseWikilinks(markdown);
  if (links.length === 0) return markdown;
  let out = "";
  let at = 0;
  for (const link of links) {
    out += markdown.slice(at, link.start);
    at = link.end;
    const target = link.kind && link.id ? index.get(keyOf(link.kind, link.id)) : undefined;
    const label = link.label || (target?.href ? target.title : "");
    out += target?.href ? `[${escapeLabel(label)}](${target.href})` : label;
  }
  return out + markdown.slice(at);
}
