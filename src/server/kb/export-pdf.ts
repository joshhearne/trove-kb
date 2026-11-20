import "server-only";
import { Lexer, type Token, type Tokens } from "marked";
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { isWorkers } from "@/lib/runtime";
import { listMarker, listTypeOf, normalizeOutlines, type ListType } from "@/server/kb/outline-lists";

/**
 * A knowledge base article written out as a PDF, and the identifying footer
 * every exported PDF carries: one made here from the article's Markdown, or
 * the document the article came from with the footer stamped on its pages.
 *
 * The layout is deliberately plain: headings, paragraphs, lists that keep
 * their numbers, code, quotes, tables and pictures, in the PDF standard
 * fonts. Those fonts cover Western European text; any other character is
 * written as its nearest plain letter, or "?". Emoji and the icons help
 * articles use in their text (⚠️, 🔧, ✅) are drawn from Noto Emoji
 * (`src/server/kb/fonts`, SIL Open Font License), in one color, and only
 * the glyphs a document uses are embedded in it.
 */

/** What every page of an exported PDF says about where it came from. */
export type ExportMarker = {
  /** Where the article is filed: "Category › Section", or its collection when it has no category. */
  place: string;
  /** Where the article can be read: the public site's address when it is there. */
  url: string;
  /** The page the article was brought in from, when it came from one. */
  sourceUrl: string | null;
  /** Already formatted for the reader. */
  exportedAt: string;
  /** Labels in the reader's language. */
  labels: { exported: string; source: string; page: (page: number, total: number) => string };
};

/** A picture the article refers to, fetched by the caller from where the collection keeps it. */
export type ImageLoader = (src: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;

const PAGE = { width: 612, height: 792 }; // US Letter
const MARGIN = { x: 56, top: 56, bottom: 72 };
const CONTENT_WIDTH = PAGE.width - MARGIN.x * 2;
const TEXT = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.82, 0.82, 0.85);
const CODE_BG = rgb(0.95, 0.95, 0.96);
const LINK = rgb(0.1, 0.33, 0.7);

/* ---------- Text the standard fonts can write ---------- */

/** Characters WinAnsi has beyond Latin-1, which the standard fonts can draw. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const SUBSTITUTES: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "⇒": "=>",
  "↔": "<->",
  "≤": "<=",
  "≥": ">=",
  "≠": "!=",
  "✓": "v",
  "✔": "v",
  "✗": "x",
  "✘": "x",
  "−": "-",
  "‐": "-",
  "‑": "-",
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "",
  "﻿": "",
  "\t": "    ",
  // Letters with no decomposition to a plain one.
  Ł: "L",
  ł: "l",
  Đ: "D",
  đ: "d",
  Ħ: "H",
  ħ: "h",
  ı: "i",
  ŀ: "l",
  Ŀ: "L",
};

/**
 * An emoji as a reader sees one: a pictograph with its presentation selector,
 * skin tone and joined parts, a pair of flag letters, or a keycap.
 */
const EMOJI =
  /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{1,2}|[0-9#*]\uFE0F?\u20E3)(?:\uFE0F|\uFE0E|\p{Emoji_Modifier}|\u20E3|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator})\uFE0F?)*/gu;
/** Joiners and selectors, which mean nothing without the emoji they belong to. */
const EMOJI_PARTS = /[\uFE0E\uFE0F\u200D\u20E3]|\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}/u;

/** Text and emoji apart. ©, ® and ™ are pictographs too, but stay text unless asked to be emoji. */
export function splitEmoji(text: string): { text: string; emoji: boolean }[] {
  const pieces: { text: string; emoji: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(EMOJI)) {
    const found = match[0];
    if ([...found].length === 1 && drawable(found)) continue;
    if (match.index > at) pieces.push({ text: text.slice(at, match.index), emoji: false });
    pieces.push({ text: found, emoji: true });
    at = match.index + found.length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), emoji: false });
  return pieces;
}

let emojiFont: Promise<Uint8Array | null> | null = null;

/** The emoji font's bytes, read once. None on Workers, which has no file system: emoji are left out there. */
function emojiFontBytes(): Promise<Uint8Array | null> {
  if (isWorkers()) return Promise.resolve(null);
  emojiFont ??= (async () => {
    try {
      const [{ readFile }, { join }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
      return new Uint8Array(await readFile(join(process.cwd(), "src/server/kb/fonts/NotoEmoji-Regular.ttf")));
    } catch (error) {
      console.error("trove-kb: the emoji font for PDF exports could not be read", error);
      return null;
    }
  })();
  return emojiFont;
}

function drawable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char);
}

/**
 * Text the standard fonts can write: substitutes first, then the letter
 * without its accents, then "?". An emoji that reaches here (in a code
 * block, in the footer) is left out rather than written as "??".
 */
export function winAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    if (drawable(char)) out += char;
    else if (char in SUBSTITUTES) out += SUBSTITUTES[char];
    else if (char === "\n" || char === "\r") out += " ";
    else if (EMOJI_PARTS.test(char)) continue;
    else {
      const plain = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += [...plain].every(drawable) && plain !== "" ? plain : "?";
    }
  }
  return out;
}

/* ---------- Inline text: runs of one style, wrapped into lines ---------- */

type Style = { bold?: boolean; italic?: boolean; code?: boolean; link?: boolean; emoji?: boolean };
type Run = { text: string; style: Style };
type Fonts = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
  /** Embedded only when the document has an emoji to draw and the font could be read. */
  emoji: PDFFont | null;
};

function fontFor(fonts: Fonts, style: Style): PDFFont {
  if (style.emoji && fonts.emoji) return fonts.emoji;
  if (style.code) return fonts.mono;
  if (style.bold && style.italic) return fonts.boldItalic;
  if (style.bold) return fonts.bold;
  if (style.italic) return fonts.italic;
  return fonts.regular;
}

/** HTML in Markdown, written as its text: tags dropped, the common entities read. */
function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function runsOf(tokens: Token[] | undefined, style: Style = {}): Run[] {
  const runs: Run[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case "strong":
        runs.push(...runsOf((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case "em":
        runs.push(...runsOf((token as Tokens.Em).tokens, { ...style, italic: true }));
        break;
      case "del":
        runs.push(...runsOf((token as Tokens.Del).tokens, style));
        break;
      case "codespan":
        runs.push({ text: htmlText((token as Tokens.Codespan).text), style: { ...style, code: true } });
        break;
      case "link": {
        const link = token as Tokens.Link;
        runs.push(...runsOf(link.tokens, { ...style, link: true }));
        break;
      }
      case "image":
        // A picture inside a line of text is named there; one on a line of its own is drawn.
        runs.push({ text: `[${(token as Tokens.Image).text || "image"}]`, style: { ...style, italic: true } });
        break;
      case "br":
        runs.push({ text: "\n", style });
        break;
      case "html":
        runs.push({ text: htmlText((token as Tokens.HTML).text), style });
        break;
      case "escape":
      case "text": {
        const text = token as Tokens.Text;
        if (text.tokens && text.tokens.length > 0) runs.push(...runsOf(text.tokens, style));
        else runs.push({ text: htmlText(text.text), style });
        break;
      }
      default:
        if ("text" in token && typeof token.text === "string") runs.push({ text: htmlText(token.text), style });
    }
  }
  return runs;
}

type Word = { text: string; style: Style; width: number; space: number };

/** Inline code is set a little smaller, so it does not tower over the text around it. */
function sizeFor(style: Style, size: number): number {
  return style.code ? size * 0.92 : size;
}
type Line = Word[];

/**
 * Words laid into lines no wider than `width`. A space between words may sit
 * in either run ("**bold** text" or "**bold **text"), so it is carried from
 * one run to the next; a word longer than a line is cut to fit.
 */
function wrap(runs: Run[], fonts: Fonts, size: number, width: number): Line[] {
  const lines: Line[] = [[]];
  let used = 0;
  let pendingSpace = false;
  const current = () => lines[lines.length - 1]!;
  const newLine = () => {
    lines.push([]);
    used = 0;
  };
  const place = (text: string, style: Style, font: PDFFont, gap: number) => {
    const wordWidth = font.widthOfTextAtSize(text, sizeFor(style, size));
    current().push({ text, style, width: wordWidth, space: gap });
    used += gap + wordWidth;
  };

  // Emoji are drawn from their own font, and dropped where there is none.
  const pieces = runs.flatMap((run): Run[] =>
    splitEmoji(run.text).flatMap((piece) =>
      !piece.emoji
        ? [{ text: piece.text, style: run.style }]
        : fonts.emoji
          ? [{ text: piece.text, style: { ...run.style, emoji: true } }]
          : [],
    ),
  );

  for (const run of pieces) {
    const font = fontFor(fonts, run.style);
    const measure = (text: string) => font.widthOfTextAtSize(text, sizeFor(run.style, size));
    for (const part of run.text.split(/(\n|\s+)/)) {
      if (part === "") continue;
      if (part === "\n") {
        newLine();
        pendingSpace = false;
        continue;
      }
      if (/^\s+$/.test(part)) {
        pendingSpace = true;
        continue;
      }
      let text = run.style.emoji ? part : winAnsi(part);
      const gap = pendingSpace && current().length > 0 ? fonts.regular.widthOfTextAtSize(" ", size) : 0;
      pendingSpace = false;
      if (used + gap + measure(text) <= width) {
        place(text, run.style, font, gap);
        continue;
      }
      if (current().length > 0) newLine();
      // Too long for any line: cut it into pieces that fit.
      while (measure(text) > width) {
        let cut = text.length - 1;
        while (cut > 1 && measure(text.slice(0, cut)) > width) cut -= 1;
        place(text.slice(0, cut), run.style, font, 0);
        newLine();
        text = text.slice(cut);
      }
      if (text) place(text, run.style, font, 0);
    }
  }
  return lines.filter((line, index) => line.length > 0 || index === 0);
}

/* ---------- The page: a cursor moving down, a new page when it runs out ---------- */

class Layout {
  page: PDFPage;
  y: number;

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN.top;
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN.bottom) {
      this.page = this.doc.addPage([PAGE.width, PAGE.height]);
      this.y = PAGE.height - MARGIN.top;
    }
  }

  gap(points: number): void {
    this.y -= points;
  }

  /** Lines of words at `x`, each line kept whole on one page. */
  lines(lines: Line[], x: number, size: number, color: RGB = TEXT, leading = 1.4): void {
    const height = size * leading;
    for (const line of lines) {
      this.ensure(height);
      let at = x;
      for (const [index, word] of line.entries()) {
        if (index > 0) at += word.space;
        const font = fontFor(this.fonts, word.style);
        this.page.drawText(word.text, {
          x: at,
          y: this.y - size,
          size: sizeFor(word.style, size),
          font,
          color: word.style.link ? LINK : color,
        });
        at += word.width;
      }
      this.y -= height;
    }
  }

  text(runs: Run[], x: number, width: number, size: number, color: RGB = TEXT): void {
    this.lines(wrap(runs, this.fonts, size, width), x, size, color);
  }
}

/* ---------- Blocks ---------- */

type Context = {
  layout: Layout;
  images: ImageLoader;
  embedded: Map<string, PDFImage | null>;
  /** Set by an outline's marker comment: how the list after it is numbered. */
  listType: ListType | null;
};

const HEADING_SIZES = [0, 18, 15, 13, 12, 11, 11];

async function picture(context: Context, token: Tokens.Image, x: number, width: number): Promise<void> {
  const { layout } = context;
  let image = context.embedded.get(token.href);
  if (image === undefined) {
    image = null;
    try {
      const found = await context.images(token.href);
      if (found?.mime === "image/png") image = await layout.doc.embedPng(found.bytes);
      else if (found?.mime === "image/jpeg") image = await layout.doc.embedJpg(found.bytes);
    } catch {
      image = null;
    }
    context.embedded.set(token.href, image);
  }
  if (!image) {
    layout.text([{ text: `[${token.text || "image"}]`, style: { italic: true } }], x, width, 10, MUTED);
    return;
  }
  const scale = Math.min(1, width / image.width, (PAGE.height - MARGIN.top - MARGIN.bottom) / image.height);
  const drawn = { width: image.width * scale, height: image.height * scale };
  layout.ensure(drawn.height + 4);
  layout.page.drawImage(image, { x, y: layout.y - drawn.height, ...drawn });
  layout.gap(drawn.height + 6);
}

/** A paragraph that is nothing but pictures draws them; any other paragraph is text. */
function onlyImages(tokens: Token[] | undefined): Tokens.Image[] | null {
  const images: Tokens.Image[] = [];
  for (const token of tokens ?? []) {
    if (token.type === "image") images.push(token as Tokens.Image);
    else if (token.type === "link" && (token as Tokens.Link).tokens?.every((inner) => inner.type === "image")) {
      images.push(...((token as Tokens.Link).tokens as Tokens.Image[]));
    } else if (!(token.type === "text" && (token as Tokens.Text).text.trim() === "") && token.type !== "br") return null;
  }
  return images.length > 0 ? images : null;
}

async function blocks(context: Context, tokens: Token[], x: number, width: number): Promise<void> {
  const { layout } = context;
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const heading = token as Tokens.Heading;
        const size = HEADING_SIZES[heading.depth] ?? 11;
        // A heading is not left alone at the foot of a page.
        layout.ensure(size * 1.4 + 30);
        layout.gap(size * 0.6);
        layout.text(runsOf(heading.tokens, { bold: true }), x, width, size);
        layout.gap(2);
        break;
      }
      case "paragraph": {
        const paragraph = token as Tokens.Paragraph;
        const images = onlyImages(paragraph.tokens);
        if (images) for (const image of images) await picture(context, image, x, width);
        else layout.text(runsOf(paragraph.tokens), x, width, 10.5);
        layout.gap(6);
        break;
      }
      case "text": {
        // Text directly in a tight list item.
        const text = token as Tokens.Text;
        layout.text(text.tokens ? runsOf(text.tokens) : [{ text: text.text, style: {} }], x, width, 10.5);
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        const start = typeof list.start === "number" ? list.start : 1;
        // A lettered or roman outline is numbered as written: a, b, c or i, ii, iii.
        const type = list.ordered ? (context.listType ?? "decimal") : "bullet";
        context.listType = null;
        const number = (at: number) => `${listMarker(type, start + at)}.`;
        const widest = list.ordered
          ? Math.max(...list.items.map((_, at) => layout.fonts.regular.widthOfTextAtSize(number(at), 10.5)))
          : 0;
        for (const [index, item] of list.items.entries()) {
          const marker = list.ordered ? number(index) : item.task ? (item.checked ? "[x]" : "[ ]") : "•";
          const indent = list.ordered ? Math.max(18, widest + 6) : 14;
          layout.ensure(15);
          layout.page.drawText(winAnsi(marker), { x, y: layout.y - 10.5, size: 10.5, font: layout.fonts.regular, color: TEXT });
          await blocks(context, item.tokens.filter((inner) => inner.type !== "checkbox"), x + indent, width - indent);
          if (list.loose) layout.gap(4);
        }
        layout.gap(4);
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        const size = 8.5;
        const height = size * 1.35;
        layout.gap(2);
        // Courier is fixed-width: long lines are cut at the characters that fit, spaces kept.
        const perLine = Math.max(10, Math.floor((width - 12) / layout.fonts.mono.widthOfTextAtSize("M", size)));
        for (const raw of code.text.split("\n")) {
          const text = winAnsi(raw.replace(/\t/g, "    "));
          for (let at = 0; at === 0 || at < text.length; at += perLine) {
            layout.ensure(height);
            layout.page.drawRectangle({ x, y: layout.y - height, width, height, color: CODE_BG });
            layout.page.drawText(text.slice(at, at + perLine), {
              x: x + 6,
              y: layout.y - size - 1,
              size,
              font: layout.fonts.mono,
              color: TEXT,
            });
            layout.y -= height;
          }
        }
        layout.gap(8);
        break;
      }
      case "blockquote": {
        const top = layout.y;
        const page = layout.page;
        await blocks(context, (token as Tokens.Blockquote).tokens, x + 12, width - 12);
        if (layout.page === page) {
          page.drawRectangle({ x, y: layout.y + 6, width: 2, height: top - layout.y - 6, color: RULE });
        }
        break;
      }
      case "table": {
        const table = token as Tokens.Table;
        const columns = table.header.length || 1;
        const cell = width / columns;
        const size = 9;
        const row = async (cells: Tokens.TableCell[], bold: boolean) => {
          const wrapped = cells.map((value) => wrap(runsOf(value.tokens, bold ? { bold: true } : {}), layout.fonts, size, cell - 8));
          const height = Math.max(1, ...wrapped.map((lines) => lines.length)) * size * 1.35 + 6;
          layout.ensure(height);
          const top = layout.y;
          for (const [index, lines] of wrapped.entries()) {
            layout.y = top - 3;
            layout.lines(lines, x + index * cell + 4, size, TEXT, 1.35);
          }
          layout.y = top - height;
          layout.page.drawLine({ start: { x, y: layout.y }, end: { x: x + width, y: layout.y }, thickness: 0.5, color: RULE });
        };
        await row(table.header, true);
        for (const cells of table.rows) await row(cells, false);
        layout.gap(8);
        break;
      }
      case "hr":
        layout.ensure(12);
        layout.page.drawLine({ start: { x, y: layout.y - 6 }, end: { x: x + width, y: layout.y - 6 }, thickness: 0.5, color: RULE });
        layout.gap(12);
        break;
      case "html": {
        const type = listTypeOf((token as Tokens.HTML).text);
        if (type) {
          context.listType = type;
          break;
        }
        const text = htmlText((token as Tokens.HTML).text).trim();
        if (text) {
          layout.text([{ text, style: {} }], x, width, 10.5);
          layout.gap(6);
        }
        break;
      }
      case "space":
        break;
      default:
        if ("text" in token && typeof token.text === "string" && token.text.trim()) {
          layout.text([{ text: htmlText(token.text), style: {} }], x, width, 10.5);
          layout.gap(6);
        }
    }
  }
}

/* ---------- The footer, on every page of every exported PDF ---------- */

/** Writes the marker at the foot of each page, below whatever the page already holds. */
export async function stampFooter(doc: PDFDocument, marker: ExportMarker): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const size = 7.5;
  for (const [index, page] of pages.entries()) {
    const { width } = page.getSize();
    const { x: left, y: bottom } = page.getCropBox();
    const margin = Math.min(MARGIN.x, width * 0.08);
    const right = left + width - margin;
    const room = width - margin * 2;
    const pageLabel = winAnsi(marker.labels.page(index + 1, pages.length));
    const pageWidth = font.widthOfTextAtSize(pageLabel, size);

    const fit = (text: string, most: number) => {
      let out = winAnsi(text);
      if (font.widthOfTextAtSize(out, size) <= most) return out;
      while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > most) out = out.slice(0, -1);
      return `${out}…`;
    };
    const lines: [string, string][] = [
      [fit(marker.place, room - pageWidth - 12), pageLabel],
      [fit(marker.url, room * 0.68), fit(`${marker.labels.exported} ${marker.exportedAt}`, room * 0.3)],
    ];
    if (marker.sourceUrl) lines.push([fit(`${marker.labels.source}: ${marker.sourceUrl}`, room), ""]);

    const base = bottom + 14;
    const top = base + lines.length * 10;
    page.drawLine({ start: { x: left + margin, y: top + 2 }, end: { x: right, y: top + 2 }, thickness: 0.4, color: RULE });
    for (const [row, [leftText, rightText]] of lines.entries()) {
      const y = top - 8 - row * 10;
      page.drawText(leftText, { x: left + margin, y, size, font, color: MUTED });
      if (rightText) {
        page.drawText(rightText, { x: right - font.widthOfTextAtSize(rightText, size), y, size, font, color: MUTED });
      }
    }
  }
}

/** The document an article came from, with the footer on its pages. */
export async function stampPdf(bytes: Uint8Array, marker: ExportMarker): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  await stampFooter(doc, marker);
  return doc.save();
}

/**
 * The article as a PDF: its title, where it is filed, its body laid out from
 * the Markdown, and the footer. A plain-text article is written as it reads.
 */
export async function articlePdf(
  article: { title: string; body: string; format: string; meta: string[]; instance: string },
  marker: ExportMarker,
  images: ImageLoader,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // The document's own properties take any text.
  doc.setTitle(article.title);
  doc.setSubject(`${marker.place} · ${marker.url}`);
  doc.setCreator(article.instance);
  doc.setProducer("Trove KB");

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
    emoji: null,
  };
  if (splitEmoji(`${article.title}\n${article.body}`).some((piece) => piece.emoji)) {
    const bytes = await emojiFontBytes();
    if (bytes) {
      doc.registerFontkit(fontkit);
      fonts.emoji = await doc.embedFont(bytes, { subset: true });
    }
  }
  const layout = new Layout(doc, fonts);
  const context: Context = { layout, images, embedded: new Map(), listType: null };

  layout.text([{ text: article.title, style: { bold: true } }], MARGIN.x, CONTENT_WIDTH, 20);
  if (article.meta.length > 0) {
    layout.gap(2);
    layout.text([{ text: article.meta.join(" · "), style: {} }], MARGIN.x, CONTENT_WIDTH, 9.5, MUTED);
  }
  layout.gap(6);
  layout.page.drawLine({
    start: { x: MARGIN.x, y: layout.y },
    end: { x: MARGIN.x + CONTENT_WIDTH, y: layout.y },
    thickness: 0.6,
    color: RULE,
  });
  layout.gap(12);

  if (article.format === "markdown") {
    await blocks(context, new Lexer({ gfm: true }).lex(normalizeOutlines(article.body)), MARGIN.x, CONTENT_WIDTH);
  } else {
    for (const paragraph of article.body.split(/\n{2,}/)) {
      layout.text([{ text: paragraph, style: {} }], MARGIN.x, CONTENT_WIDTH, 10.5);
      layout.gap(6);
    }
  }

  await stampFooter(doc, marker);
  return doc.save();
}
