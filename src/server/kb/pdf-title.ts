import { basename, extname } from "node:path";

/** What a title line needs from each piece of text on the page. */
export type PageTextItem = {
  str: string;
  y: number;
  fontSize: number;
  hasEOL: boolean;
};

const MAX_TITLE = 200;
const MIN_TITLE = 3;

/** A heading has to stand out from the body text by at least this much. */
const HEADING_RATIO = 1.2;

/** A title that wraps runs over a few lines at most; past that it is a paragraph. */
const MAX_TITLE_LINES = 3;

/** Placeholders that authoring and print software write when nobody set a title. */
const PLACEHOLDER = /^(untitled|untitled document|document\d*|doc\d*|title|presentation\d*|book\d*|slide \d+|page \d+|new document)$/i;

/** Software that writes "<App> - <file name>" into the Title property. */
const APP_PREFIX = /^(microsoft (word|excel|powerpoint)|word|excel|powerpoint|google docs|pages|libreoffice writer)\s+-\s+/i;

const FILE_NAME = /\.(pdf|docx?|xlsx?|pptx?|odt|rtf|txt|md|html?)$/i;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function plainName(path: string): string {
  return normalize(basename(path, extname(path)).replace(/[-_]+/g, " ")).toLowerCase();
}

/** Clips a long title at a word boundary. */
function clip(text: string): string {
  if (text.length <= MAX_TITLE) return text;
  const cut = text.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(" ");
  return `${(space > MAX_TITLE / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The PDF's own Title property, unless it is a placeholder or only repeats a
 * file name, which the file name already gives.
 */
export function titleFromPdfInfo(info: Record<string, unknown> | undefined, path: string): string | null {
  const raw = info?.["Title"];
  if (typeof raw !== "string") return null;

  const title = normalize(raw);
  if (title.length < MIN_TITLE) return null;
  if (PLACEHOLDER.test(title)) return null;
  if (APP_PREFIX.test(title) || FILE_NAME.test(title)) return null;
  if (title.toLowerCase() === plainName(path)) return null;
  if (!/\p{L}/u.test(title)) return null;
  return clip(title);
}

type Line = { text: string; fontSize: number; y: number };

/** Groups a page's text items into lines, top of the page first. */
function linesOf(items: PageTextItem[]): Line[] {
  const lines: Line[] = [];
  let parts: string[] = [];
  let size = 0;
  let y: number | null = null;

  const flush = () => {
    const text = normalize(parts.join(""));
    if (text !== "" && y !== null) lines.push({ text, fontSize: size, y });
    parts = [];
    size = 0;
    y = null;
  };

  for (const item of items) {
    // A new baseline starts a new line even when the item before it didn't
    // say so; PDFs often leave hasEOL off.
    if (y !== null && Math.abs(item.y - y) > Math.max(2, item.fontSize / 2)) flush();
    if (item.str.trim() !== "") {
      parts.push(item.str);
      size = Math.max(size, item.fontSize);
      y ??= item.y;
    } else if (item.str !== "") {
      parts.push(" ");
    }
    if (item.hasEOL) flush();
  }
  flush();

  return lines.sort((a, b) => b.y - a.y);
}

/** The size most of the page's characters are set in. */
function bodySize(lines: Line[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.fontSize * 2) / 2;
    weight.set(size, (weight.get(size) ?? 0) + line.text.length);
  }
  let best = 0;
  let most = -1;
  for (const [size, count] of weight) {
    if (count > most) {
      best = size;
      most = count;
    }
  }
  return best;
}

/**
 * The first page's title as a reader sees it: the largest text on the page,
 * when it clearly stands out from the body text. A title that wraps is joined
 * back into one line.
 */
export function titleFromFirstPage(items: PageTextItem[]): string | null {
  const lines = linesOf(items);
  if (lines.length < 2) return null;

  const largest = Math.max(...lines.map((line) => line.fontSize));
  if (largest < bodySize(lines) * HEADING_RATIO) return null;

  const start = lines.findIndex((line) => line.fontSize >= largest - 0.5);
  const run: string[] = [];
  for (const line of lines.slice(start)) {
    if (line.fontSize < largest - 0.5 || run.length === MAX_TITLE_LINES) break;
    run.push(line.text);
  }

  const title = normalize(run.join(" "));
  if (title.length < MIN_TITLE || !/\p{L}/u.test(title)) return null;
  return clip(title);
}
