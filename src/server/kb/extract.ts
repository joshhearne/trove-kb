import "server-only";
import { basename, extname } from "node:path";
import { acceptUpload } from "@/server/uploads/accept";
import { asDate, asText, parseFrontmatter } from "@/server/kb/frontmatter";

/**
 * Turns one file into an article. What the file is comes from its own bytes,
 * by the same rules an attachment is held to; the name only proposes.
 *
 * Documents only: Markdown, text, PDF, Word (.docx) and HTML pages. Anything
 * else in a folder (a Visio drawing, a spreadsheet, an installer) is not an
 * article and is passed over; pictures are kept for the articles that use them.
 * A legacy Word file (.doc) is refused, as an attachment is, since it can
 * carry macros and there is no reader for its text here.
 */

export type SourceType = "md" | "txt" | "pdf" | "docx" | "html";

export type ExtractedArticle = {
  title: string;
  body: string;
  format: "markdown" | "text";
  sourceType: SourceType;
  extraction: "ok" | "unextracted";
  externalId: string | null;
  sourceUrl: string | null;
  category: string | null;
  subcategory: string | null;
  dateCreated: Date | null;
  dateModified: Date | null;
  metadata: Record<string, unknown>;
  /** A runbook keeps its steps apart; an article is the default. */
  kind?: ArticleKind;
  /** Frontmatter `internal_only`: true keeps the article off the public site. Absent leaves it as it was. */
  publicHidden?: boolean;
};

/** A file that is not an article, which is not the same as one that failed. */
export class NotAnArticleError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "NotAnArticleError";
  }
}

/** Frontmatter keys that have a column of their own. */
const CLAIMED = new Set([
  "title",
  "article_id",
  "external_id",
  "id",
  "url",
  "source_url",
  "category",
  "subcategory",
  "date_created",
  "date_modified",
  "created",
  "modified",
  "kind",
  "internal_only",
]);

export const ARTICLE_KINDS = ["article", "runbook"] as const;
export type ArticleKind = (typeof ARTICLE_KINDS)[number];

function asKind(value: unknown): ArticleKind {
  return typeof value === "string" && value.trim().toLowerCase() === "runbook" ? "runbook" : "article";
}

function asFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|yes|on)$/i.test(value.trim())) return true;
  if (typeof value === "string" && /^(false|no|off)$/i.test(value.trim())) return false;
  return undefined;
}

/** A page of real text has far more than this; a scan has a stray mark or none. */
const MIN_CHARS_PER_PAGE = 16;

function titleFromName(path: string): string {
  const name = basename(path, extname(path)).replace(/[-_]+/g, " ").trim();
  return name === "" ? "Untitled" : name;
}

function firstHeading(markdown: string): string | null {
  const match = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return match?.[1]?.trim() || null;
}

/**
 * `articles/<Category>/<Subcategory>/file.md` says where an article belongs
 * when its frontmatter does not. A leading folder that only names the pile
 * is not a category.
 */
export function categoryFromPath(path: string): { category: string | null; subcategory: string | null } {
  const folders = path.split("/").slice(0, -1);
  if (folders[0] && /^(articles|docs|kb|content)$/i.test(folders[0])) folders.shift();
  return { category: folders[0] ?? null, subcategory: folders[1] ?? null };
}

/** YAML dates parse to Date objects, which JSON would flatten without saying so. */
function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
}

function fromMarkdown(path: string, source: string): ExtractedArticle {
  const { data, body } = parseFrontmatter(source);
  const place = categoryFromPath(path);

  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!CLAIMED.has(key)) metadata[key] = plain(value);
  }

  return {
    title: asText(data.title) ?? firstHeading(body) ?? titleFromName(path),
    body: body.trim(),
    format: "markdown",
    sourceType: "md",
    extraction: "ok",
    externalId: asText(data.article_id) ?? asText(data.external_id) ?? asText(data.id),
    sourceUrl: safeUrl(asText(data.url) ?? asText(data.source_url)),
    category: asText(data.category) ?? place.category,
    subcategory: asText(data.subcategory) ?? place.subcategory,
    dateCreated: asDate(data.date_created ?? data.created),
    dateModified: asDate(data.date_modified ?? data.modified),
    metadata,
    kind: asKind(data.kind),
    publicHidden: asFlag(data.internal_only),
  };
}

/** Only a web address is kept: this is rendered as a link. */
export function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function bare(path: string, sourceType: SourceType): ExtractedArticle {
  return {
    title: titleFromName(path),
    body: "",
    format: "markdown",
    sourceType,
    extraction: "ok",
    externalId: null,
    sourceUrl: null,
    ...categoryFromPath(path),
    dateCreated: null,
    dateModified: null,
    metadata: {},
  };
}

async function fromPdf(path: string, bytes: Buffer): Promise<ExtractedArticle> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages = text.map((page) => page.trim());
  const characters = pages.reduce((sum, page) => sum + page.replace(/\s/g, "").length, 0);
  const article = bare(path, "pdf");
  article.format = "text";
  article.metadata = { pages: totalPages };

  // Only the text layer is read. A scan has none, and saying so is more use
  // than failing the import or storing an empty article as if it were whole.
  if (characters < MIN_CHARS_PER_PAGE * Math.max(1, totalPages)) {
    article.extraction = "unextracted";
    return article;
  }

  article.body = pages.filter((page) => page !== "").join("\n\n");
  return article;
}

async function fromDocx(path: string, bytes: Buffer): Promise<ExtractedArticle> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml(
    { buffer: bytes },
    // Pictures would arrive as megabytes of base64 in the middle of the text.
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );

  const { htmlToMarkdown } = await import("@/server/kb/html");
  const body = htmlToMarkdown(html);

  const article = bare(path, "docx");
  if (body.replace(/\s/g, "").length < MIN_CHARS_PER_PAGE) {
    article.extraction = "unextracted";
    return article;
  }

  article.body = body;
  article.title = firstHeading(body) ?? article.title;
  return article;
}

/**
 * An HTML page saved as a file: a help article exported from somewhere, a
 * formatted procedure. Taken only when its bytes are an HTML document; the
 * name ending in .html is not enough. It becomes Markdown, as a crawled page
 * does, and nothing of the page runs or is drawn as it was.
 */
export function looksLikeHtml(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  const head = bytes.subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return /^(<!--[\s\S]*?-->\s*)*<(!doctype html|html|head|body)[\s>]/.test(head);
}

async function fromHtml(path: string, bytes: Buffer): Promise<ExtractedArticle> {
  const { htmlToMarkdown, mainContent, pageTitle } = await import("@/server/kb/html");
  const html = bytes.toString("utf8");
  const body = htmlToMarkdown(mainContent(html));
  const article = bare(path, "html");
  if (body.replace(/\s/g, "").length < MIN_CHARS_PER_PAGE) {
    article.extraction = "unextracted";
    return article;
  }
  article.body = body;
  article.title = pageTitle(html) ?? firstHeading(body) ?? article.title;
  return article;
}

const HTML_EXTENSIONS = new Set(["html", "htm"]);

export async function extractArticle(path: string, bytes: Buffer): Promise<ExtractedArticle> {
  if (HTML_EXTENSIONS.has(extname(path).slice(1).toLowerCase())) {
    if (!looksLikeHtml(bytes)) throw new NotAnArticleError("The file is named .html but is not an HTML page");
    return fromHtml(path, bytes);
  }

  let accepted;
  try {
    accepted = await acceptUpload(basename(path), bytes, async () => {
      throw new NotAnArticleError("An image is not an article");
    });
  } catch (error) {
    if (error instanceof NotAnArticleError) throw error;
    throw new NotAnArticleError(error instanceof Error ? error.message : "Not an accepted type");
  }

  switch (accepted.extension) {
    case "md":
      return fromMarkdown(path, bytes.toString("utf8"));
    case "txt": {
      const article = bare(path, "txt");
      article.format = "text";
      article.body = bytes.toString("utf8").replace(/^﻿/, "");
      return article;
    }
    case "pdf":
      return fromPdf(path, bytes);
    case "docx":
      return fromDocx(path, bytes);
    default:
      throw new NotAnArticleError(`${accepted.extension} files are not imported as articles`);
  }
}
