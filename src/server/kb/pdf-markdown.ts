import { bodySize, linesOf, type Line, type PageTextItem } from "@/server/kb/pdf-title";

/**
 * A PDF's text layer as Markdown. A PDF keeps no structure, only text at a
 * size and a place, so the structure is read back the way a reader sees it:
 *
 * - text set clearly larger than the body is a heading, the largest size
 *   `#`, the next `##`, anything smaller `###`
 * - a bigger gap than the line spacing ends a paragraph; lines within one
 *   are joined back into running text
 * - a line starting with a bullet or a number is a list item
 * - a line repeated at the top or bottom of most pages (a running header, a
 *   footer, a page number) is page furniture, not the article
 *
 * Bold body text at the body size can't be told from plain text here, so it
 * stays a paragraph.
 */

/** A body heading need not shout like a title: 13pt over 11pt body text counts. */
const HEADING_RATIO = 1.15;
const MAX_HEADING = 120;
const MAX_LEVELS = 3;

/** A paragraph ends where the gap is this much more than the line height. */
const PARAGRAPH_GAP = 1.6;

/** A bullet glyph, or a dash or star with a space after it (not "-5 dBm"). */
const BULLET = /^(?:[•◦▪▫●○■□‣⁃]\s*|[–—*-]\s+)(.+)$/u;
const NUMBERED = /^(\d{1,3})[.)]\s+(.+)$/;
const PAGE_NUMBER = /^(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

/** How far in from the top or bottom (in lines) a running header or footer sits. */
function edgeLines(lines: Line[]): number {
  // On a short page two lines from each edge would be the whole page.
  return lines.length > 4 ? 2 : 1;
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "item"; marker: string; text: string };

/** Marks Markdown would act on, so the text reads as written. */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]<>|])/g, "\\$1");
}

/** A paragraph that happens to start like Markdown syntax. */
function escapeStart(text: string): string {
  return text.replace(/^(#{1,6}\s|[-+]\s|\d+([.)])\s|>)/, (start) =>
    /^\d/.test(start) ? start.replace(/([.)])/, "\\$1") : `\\${start}`,
  );
}

/** The same text with its numbers blanked, so "Page 3" matches "Page 4". */
function shape(text: string): string {
  return text.replace(/\d+/g, "#").toLowerCase();
}

/**
 * Lines that sit in the top or bottom couple of lines on most pages with the
 * same wording (numbers aside), and bare page numbers anywhere at the edges.
 */
function furniture(pages: Line[][], body: number): Set<string> {
  const counts = new Map<string, { pages: number; size: number }>();
  for (const lines of pages) {
    const edge = [...lines.slice(0, edgeLines(lines)), ...lines.slice(-edgeLines(lines))];
    const seen = new Map<string, number>();
    for (const line of edge) seen.set(shape(line.text), Math.max(seen.get(shape(line.text)) ?? 0, line.fontSize));
    for (const [key, size] of seen) {
      const count = counts.get(key);
      counts.set(key, { pages: (count?.pages ?? 0) + 1, size: Math.max(count?.size ?? 0, size) });
    }
  }
  const repeated = new Set<string>();
  if (pages.length < 2) return repeated;
  for (const [key, { pages: count, size }] of counts) {
    // Two pages are thin evidence; there it also has to be small print.
    if (pages.length === 2 ? count === 2 && size < body : count >= Math.ceil(pages.length * 0.6)) {
      repeated.add(key);
    }
  }
  return repeated;
}

function isFurniture(lines: Line[], index: number, repeated: Set<string>): boolean {
  const line = lines[index];
  if (!line) return false;
  const atEdge = index < edgeLines(lines) || index >= lines.length - edgeLines(lines);
  if (!atEdge) return false;
  return PAGE_NUMBER.test(line.text) || repeated.has(shape(line.text));
}

/** Heading sizes, largest first, that stand out from the body. */
function headingSizes(lines: Line[], body: number): number[] {
  const sizes = new Set<number>();
  for (const line of lines) {
    const size = Math.round(line.fontSize * 2) / 2;
    if (size >= body * HEADING_RATIO && line.text.length <= MAX_HEADING && /\p{L}/u.test(line.text)) {
      sizes.add(size);
    }
  }
  return [...sizes].sort((a, b) => b - a);
}

function levelOf(line: Line, sizes: number[]): number | null {
  const size = Math.round(line.fontSize * 2) / 2;
  const rank = sizes.indexOf(size);
  if (rank === -1 || line.text.length > MAX_HEADING || !/\p{L}/u.test(line.text)) return null;
  return Math.min(rank + 1, MAX_LEVELS);
}

/** Joins a wrapped line onto the one before it. */
function join(before: string, after: string): string {
  if (/\p{L}-$/u.test(before) && /^\p{L}/u.test(after)) {
    // "configu-" + "ration" is a word the line broke; "SSL-" + "VPN" keeps its hyphen.
    return /\p{Ll}-$/u.test(before) && /^\p{Ll}/u.test(after)
      ? `${before.slice(0, -1)}${after}`
      : `${before}${after}`;
  }
  return `${before} ${after}`;
}

/** Where body text starts and how far a full line runs, across the document. */
type Margins = { left: number; right: number } | null;

/** Indented further than this from the body's left edge is a list item's text. */
const INDENT = 8;

function marginsOf(lines: Line[], body: number): Margins {
  const weight = new Map<number, number>();
  const rights: number[] = [];
  for (const line of lines) {
    if (line.left === null || line.right === null) continue;
    if (Math.abs(line.fontSize - body) > 0.5) continue;
    const left = Math.round(line.left);
    weight.set(left, (weight.get(left) ?? 0) + line.text.length);
    rights.push(line.right);
  }
  if (weight.size === 0) return null;
  // The leftmost edge that a fair share of the body starts at. Not the most
  // common one: in a list-heavy page that is the items' indent.
  const total = [...weight.values()].reduce((sum, count) => sum + count, 0);
  const left = Math.min(...[...weight].filter(([, count]) => count >= total * 0.15).map(([at]) => at));
  return { left, right: Math.max(...rights) };
}

/**
 * Whether `line` carries on from `before`: `before` had no room left for the
 * next line's first word, and didn't end a sentence that `line` starts anew.
 * (Without a bullet glyph, that's all that tells two list items apart.)
 */
function wrappedInto(before: Line, line: Line, right: number): boolean {
  if (before.left === null || before.right === null || before.text.length === 0) return false;
  const perChar = (before.right - before.left) / before.text.length;
  const firstWord = line.text.split(" ")[0] ?? "";
  const fits = before.right + perChar * (firstWord.length + 1) <= right;
  if (fits) return false;
  return !(/[.!?:]$/.test(before.text) && /^\p{Lu}/u.test(line.text));
}

function blocksOf(lines: Line[], sizes: number[], body: number, margins: Margins): Block[] {
  const blocks: Block[] = [];
  let previous: Line | null = null;

  for (const line of lines) {
    const level = levelOf(line, sizes);
    const last = blocks.at(-1);
    const before = previous;
    const gap = before ? Math.abs(before.y - line.y) : Infinity;
    const close = gap <= Math.max(line.fontSize, body) * PARAGRAPH_GAP;
    previous = line;

    if (level !== null) {
      // A heading that wraps arrives as two lines at the same size.
      if (last?.kind === "heading" && last.level === level && close) last.text = join(last.text, line.text);
      else blocks.push({ kind: "heading", level, text: line.text });
      continue;
    }

    const bullet = BULLET.exec(line.text);
    const numbered = NUMBERED.exec(line.text);
    if (bullet) {
      blocks.push({ kind: "item", marker: "-", text: bullet[1] ?? "" });
      continue;
    }
    if (numbered) {
      blocks.push({ kind: "item", marker: `${numbered[1]}.`, text: numbered[2] ?? "" });
      continue;
    }

    if (margins && line.left !== null) {
      // Bullets drawn as shapes leave no mark in the text; the item's text is
      // still indented from the body. It continues the item above only when
      // that line ran to the margin, i.e. wrapped.
      const indented = line.left >= margins.left + INDENT;
      const wrapped = before !== null && wrappedInto(before, line, margins.right);
      if (indented) {
        if (last?.kind === "item" && close && wrapped) last.text = join(last.text, line.text);
        else blocks.push({ kind: "item", marker: "-", text: line.text });
        continue;
      }
      if (last?.kind === "item") {
        blocks.push({ kind: "paragraph", text: line.text });
        continue;
      }
    }

    if ((last?.kind === "paragraph" || last?.kind === "item") && close) {
      last.text = join(last.text, line.text);
    } else {
      blocks.push({ kind: "paragraph", text: line.text });
    }
  }
  return blocks;
}

function render(blocks: Block[]): string {
  let out = "";
  blocks.forEach((block, index) => {
    const before = blocks[index - 1];
    // Items of one list sit on consecutive lines; anything else gets a blank line.
    if (before) out += before.kind === "item" && block.kind === "item" ? "\n" : "\n\n";
    if (block.kind === "heading") out += `${"#".repeat(block.level)} ${escapeInline(block.text)}`;
    else if (block.kind === "item") out += `${block.marker} ${escapeInline(block.text)}`;
    else out += escapeStart(escapeInline(block.text));
  });
  return out.trim();
}

/** Pages of text items, as `getTextContent` gives them, as one Markdown body. */
export function pdfPagesToMarkdown(pages: PageTextItem[][]): string {
  const pageLines = pages.map((items) => linesOf(items, { inOrder: true }));
  if (pageLines.every((lines) => lines.length === 0)) return "";
  const repeated = furniture(pageLines, bodySize(pageLines.flat()));
  const kept = pageLines.map((lines) => lines.filter((_, index) => !isFurniture(lines, index, repeated)));

  const all = kept.flat();
  if (all.length === 0) return "";
  const body = bodySize(all);
  const sizes = headingSizes(all, body).slice(0, 6);
  const margins = marginsOf(all, body);

  return kept
    .map((lines) => render(blocksOf(lines, sizes, body, margins)))
    .filter((page) => page !== "")
    .join("\n\n");
}
