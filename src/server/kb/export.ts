import { stringify } from "yaml";

/**
 * Which forms an article can be exported in, which one it is offered in
 * first, and the Markdown form with its identifying header.
 *
 * An article's own form comes first: a PDF when it was made from one, its
 * Markdown otherwise. A PDF can always be had, made from the text; the
 * document it came from (a Word file, a saved web page) is offered as well
 * when it was kept and is not a PDF.
 */

export const EXPORT_FORMATS = ["pdf", "md", "original"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

export type ExportOptions = {
  /** Offered first: the article's own form. */
  native: "pdf" | "md";
  /** Every form, the native one first. */
  formats: ExportFormat[];
  /** The kept file's name when "original" is offered, for its label. */
  originalName: string | null;
};

export function exportOptions(original: { mime: string; name: string } | null): ExportOptions {
  const pdfOriginal = original?.mime === "application/pdf";
  const native = pdfOriginal ? "pdf" : "md";
  const formats: ExportFormat[] = native === "pdf" ? ["pdf", "md"] : ["md", "pdf"];
  if (original && !pdfOriginal) formats.push("original");
  return { native, formats, originalName: original && !pdfOriginal ? original.name : null };
}

/** A file name from the title: what a reader would call it, safe on every system. */
export function exportFilename(title: string, extension: string): string {
  const base = title
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 120)
    .trim();
  return `${base || "article"}.${extension}`;
}

/** A runbook keeps each step's id at the end of its line, `{#id}`, which only matters to Trove KB. */
export function withoutStepIds(body: string): string {
  return body.replace(/[ \t]*\{#[A-Za-z0-9_-]+\}[ \t]*$/gm, "");
}

export type MarkdownExport = {
  title: string;
  body: string;
  collection: string;
  category: string | null;
  subcategory: string | null;
  kind: "article" | "runbook";
  sourceUrl: string | null;
  /** Where the article can be read. */
  url: string;
  articleId: string;
  /** The instance's own name, or Trove KB's. */
  instance: string;
  exportedAt: Date;
};

/** Whether the body opens with the title as a heading of its own. */
function opensWithTitle(body: string, title: string): boolean {
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(body);
  const same = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return !!match && same(match[1] ?? "") === same(title);
}

/** The body without a heading that only repeats the title, for a PDF that sets the title itself. */
export function withoutLeadingTitle(body: string, title: string): string {
  if (!opensWithTitle(body, title)) return body;
  return body.replace(/^\s*#\s+.+?(?:\n|$)/, "").replace(/^\s*\n/, "");
}

/**
 * The article as a Markdown file: a front matter block at the top naming
 * where it can be read, where it is filed, and where it came from, then the
 * body as stored (less a runbook's step ids), opening with the title. The keys are ones an import reads
 * (title, category, section, kind, source_url), so the file can be brought
 * back in; `kb_url` and the rest are kept as notes on it.
 */
export function markdownExport(article: MarkdownExport): string {
  const header: Record<string, string> = { title: article.title, kb_url: article.url };
  if (article.category) header.category = article.category;
  if (article.subcategory) header.section = article.subcategory;
  header.collection = article.collection;
  if (article.sourceUrl) header.source_url = article.sourceUrl;
  if (article.kind === "runbook") header.kind = "runbook";
  header.exported_from = article.instance;
  header.exported_at = article.exportedAt.toISOString();
  header.trove_article_id = article.articleId;

  const body = withoutStepIds(article.body).replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").trimEnd();
  const titled = opensWithTitle(body, article.title) ? body : `# ${article.title.replace(/\s+/g, " ").trim()}\n\n${body}`;
  return `---\n${stringify(header, { lineWidth: 0 }).trimEnd()}\n---\n\n${titled.trimEnd()}\n`;
}
