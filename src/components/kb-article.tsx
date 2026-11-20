import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, ChevronLeft, Download, ExternalLink, FileText, ListChecks } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import { RunbookRun, RunbookSteps, type RenderedStep } from "@/components/kb-runbook-steps";
import { deriveRunbook, type RunbookStep } from "@/server/kb/runbook";
import { leafSteps, type NestedStep } from "@/server/kb/runbook-nest";
import { renderArticleMarkdown, renderMarkdown } from "@/server/fields/render";
import { outlineHtml } from "@/server/kb/outline";
import { embedVideos } from "@/server/kb/video";
import { KbOutline } from "@/components/kb-outline";
import type { ArticleDetail } from "@/server/services/kb";
import { originalOf } from "@/server/services/kb-import";
import { exportOptions, type ExportFormat } from "@/server/kb/export";
import type { WikilinkIndex } from "@/lib/wikilinks";
import type { PageBacklinks } from "@/server/services/kb-links";
import { formatBytes, formatDateTime } from "@/i18n/format";
import type { Messages } from "@/i18n";
import type { Locale } from "@/i18n/locales";

type Attachment = { name: string; extracted: boolean };

/** Attachments arrive as names, or as names with whether their text was read. */
function attachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Attachment[] => {
    if (typeof item === "string") return [{ name: item, extracted: true }];
    if (typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string") {
      const entry = item as { name: string; extracted?: unknown };
      return [{ name: entry.name, extracted: entry.extracted !== false }];
    }
    return [];
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * An exported article usually opens with its own title as a heading. The page
 * already shows the title, so the repeat is left out of what is drawn — the
 * stored article keeps it.
 */
function withoutLeadingTitle(body: string, title: string): string {
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(body);
  if (!match) return body;

  const same = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  return same(match[1] ?? "") === same(title) ? body.slice(match[0].length) : body;
}

/**
 * Export, in the article's own format first: a button for that one and a
 * menu for the rest. Plain links in a disclosure, so it needs no script and
 * works the same on the public site.
 */
function ExportMenu({
  href,
  original,
  t,
}: {
  href: string;
  original: { mime: string; name: string } | null;
  t: Messages;
}) {
  const options = exportOptions(original);
  const label = (format: ExportFormat) =>
    format === "original" ? t.kb.export.original(options.originalName ?? "") : t.kb.export.as(t.kb.export[format]);
  const link = (format: ExportFormat) => `${href}?format=${format}`;
  const others = options.formats.filter((format) => format !== options.native);

  return (
    <div className="relative inline-flex items-stretch rounded-md border text-sm">
      <a
        href={link(options.native)}
        download
        className="inline-flex items-center gap-1.5 rounded-l-md px-3 py-1.5 hover:bg-[var(--muted)]"
      >
        <Download className="size-4 shrink-0" aria-hidden />
        <span className="font-medium">{label(options.native)}</span>
      </a>
      <details className="border-l">
        <summary
          className="flex h-full cursor-pointer list-none items-center rounded-r-md px-2 hover:bg-[var(--muted)] [&::-webkit-details-marker]:hidden"
          aria-label={t.kb.export.menu}
          title={t.kb.export.menu}
        >
          <ChevronDown className="size-4" aria-hidden />
        </summary>
        <div className="absolute top-full left-0 z-20 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-md border bg-[var(--card)] p-1 shadow-lg">
          {others.map((format) => (
            <a
              key={format}
              href={link(format)}
              download
              className="rounded px-3 py-2 break-words hover:bg-[var(--muted)]"
            >
              {label(format)}
            </a>
          ))}
          <p className="border-t px-3 py-2 text-xs text-[var(--muted-foreground)]">{t.kb.export.hint}</p>
        </div>
      </details>
    </div>
  );
}

/**
 * One article, as a signed-in reader and a visitor to the public site both
 * see it. What differs between them is where "back" goes and what sits beside
 * the title, which the page supplies.
 */
export function KbArticle({
  article,
  backHref,
  originalHref,
  exportHref,
  actions,
  links,
  backlinks,
  articleBase = "/kb/articles",
  nested,
  locale,
  t,
}: {
  article: ArticleDetail;
  backHref: string;
  /** Where the document the article was made from is served, when it was kept. */
  originalHref?: string;
  /** Where the article is exported from; `?format=` is added. */
  exportHref?: string;
  actions?: React.ReactNode;
  /** The pages its [[links]] point at, as this reader may open them. */
  links?: WikilinkIndex;
  /** The pages linking to it that this reader may open. */
  backlinks?: PageBacklinks;
  /** Where an article is opened on this site: the app, or the public site. */
  articleBase?: string;
  /** A runbook's steps with each link to another runbook opened into its steps. */
  nested?: NestedStep[];
  locale: Locale;
  t: Messages;
}) {
  const unread = attachments(article.metadata.doc_attachments).filter((item) => !item.extracted);
  const original = originalHref ? originalOf(article.metadata) : null;
  const markdown = article.extraction !== "unextracted" && article.format === "markdown";
  const runbook = markdown && article.kind === "runbook" ? deriveRunbook(article.body, article.steps) : null;

  // A runbook is drawn by turns: prose, a checklist, prose again. The outline
  // is read across every piece of prose at once, so its ids are on the
  // headings that are drawn; a marker keeps the pieces apart until then.
  const MARK = "<!--runbook-steps-->";
  const source = runbook
    ? runbook.segments
        .map((segment, index) =>
          segment.kind === "markdown"
            ? embedVideos(renderArticleMarkdown(index === 0 ? withoutLeadingTitle(segment.text, article.title) : segment.text, links))
            : MARK,
        )
        .join("")
    : markdown
      ? embedVideos(renderArticleMarkdown(withoutLeadingTitle(article.body, article.title), links))
      : null;
  const drawn = source !== null ? outlineHtml(source) : null;
  // A step that is only a link to another runbook opens into that runbook's steps.
  const nestedById = new Map((nested ?? []).map((node) => [node.id, node]));
  const renderNested = (node: NestedStep): RenderedStep => ({
    id: node.path,
    // A runbook the reader may not read is named, never linked.
    html: node.runbook
      ? node.runbook.status === "unavailable"
        ? escapeHtml(node.text)
        : `<a href="${articleBase}/${node.runbook.id}">${escapeHtml(node.text)}</a>`
      : renderMarkdown(node.text, links).replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1"),
    noteHtml: node.note ? embedVideos(renderArticleMarkdown(node.note, links)) : null,
    canned: node.canned ?? null,
    runbook: node.runbook ? { status: node.runbook.status } : null,
    children: node.children.map(renderNested),
  });
  const renderPlain = (step: RunbookStep): RenderedStep => ({
    id: step.id,
    html: renderMarkdown(step.text, links).replace(/^<p>([\s\S]*)<\/p>\s*$/, "$1"),
    noteHtml: step.note ? embedVideos(renderArticleMarkdown(step.note, links)) : null,
    canned: step.canned ?? null,
    runbook: null,
    children: [],
  });
  const rendered = (step: RunbookStep): RenderedStep => {
    const node = nestedById.get(step.id);
    if (node?.runbook) return renderNested(node);
    return renderPlain(step);
  };
  const pieces =
    runbook && drawn
      ? (() => {
          const prose = drawn.html.split(MARK);
          let at = 0;
          return runbook.segments.map((segment) =>
            segment.kind === "markdown"
              ? { kind: "html" as const, html: prose[at++] ?? "" }
              : { kind: "steps" as const, from: segment.from, steps: runbook.steps.slice(segment.from, segment.to).map(rendered) },
          );
        })()
      : null;

  return (
    <div className="flex items-start gap-8">
      <article className="flex min-w-0 max-w-4xl flex-1 flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            href={backHref as Route}
            className="inline-flex items-center gap-1 text-sm text-[var(--muted-foreground)] hover:underline"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {t.kb.backTo(article.collectionName)}
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight break-words">
            {article.title}
            {article.kind === "runbook" && (
              <Chip tone="blue" icon={ListChecks} className="ml-3 align-middle text-xs">
                {t.kb.runbook}
              </Chip>
            )}
          </h1>

          <p className="text-sm text-[var(--muted-foreground)]">
            {[
              article.category,
              article.subcategory,
              article.externalId && article.sourceType !== "html"
                ? t.kb.articleId(article.externalId)
                : null,
              article.dateCreated ? t.kb.created(formatDateTime(article.dateCreated, locale)) : null,
              article.dateModified ? t.kb.modified(formatDateTime(article.dateModified, locale)) : null,
              t.kb.imported(formatDateTime(article.updatedAt, locale)),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {article.sourceUrl && (
              <a
                href={article.sourceUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
              >
                <ExternalLink className="size-4 shrink-0" aria-hidden />
                <span className="shrink-0 font-medium">{t.kb.source}</span>
                <span className="truncate text-[var(--muted-foreground)]">{article.sourceUrl}</span>
              </a>
            )}
            {original && (
              <a
                href={originalHref}
                target="_blank"
                rel="noopener noreferrer"
                className={
                  "inline-flex max-w-full items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-[var(--muted)]" +
                  (original.mime === "application/pdf" ? " kb-attention" : "")
                }
              >
                <FileText className="size-4 shrink-0" aria-hidden />
                <span className="shrink-0 font-medium">
                  {original.mime === "application/pdf" ? t.kb.openPdf : t.kb.downloadOriginal}
                </span>
                <span className="truncate text-[var(--muted-foreground)]">
                  {original.name} · {formatBytes(original.bytes, locale)}
                </span>
              </a>
            )}
            {exportHref && <ExportMenu href={exportHref} original={originalOf(article.metadata)} t={t} />}
            {actions}
          </div>
        </header>

        {original?.mime === "application/pdf" && (
          <p role="note" className="rounded-md border px-3 py-2 text-sm text-[var(--muted-foreground)]">
            {t.kb.pdfHint}
          </p>
        )}

        {unread.length > 0 && (
          <p role="note" className="rounded-md border px-3 py-2 text-sm">
            {t.kb.unextractedAttachments(unread.map((item) => item.name).join(", "))}
          </p>
        )}

        {article.extraction === "unextracted" ? (
          <p role="note" className="rounded-md border px-3 py-2 text-sm">
            {t.kb.unextractedBody}
          </p>
        ) : pieces ? (
          <RunbookRun total={nested ? leafSteps(nested).length : (runbook?.steps.length ?? 0)}>
            {pieces.map((piece, index) =>
              piece.kind === "html" ? (
                piece.html.trim() === "" ? null : (
                  <div
                    key={index}
                    className="prose-editor kb-article min-w-0 text-sm break-words"
                    dangerouslySetInnerHTML={{ __html: piece.html }}
                  />
                )
              ) : (
                <RunbookSteps key={index} steps={piece.steps} first={piece.from} last={!pieces.slice(index + 1).some((later) => later.kind === "steps")} />
              ),
            )}
          </RunbookRun>
        ) : drawn ? (
          <div
            className="prose-editor kb-article min-w-0 text-sm break-words"
            dangerouslySetInnerHTML={{ __html: drawn.html }}
          />
        ) : (
          <pre className="min-w-0 font-sans text-sm break-words whitespace-pre-wrap">{article.body}</pre>
        )}

        {backlinks && backlinks.documents.length + backlinks.articles.length > 0 && (
          <section aria-labelledby="kb-backlinks" className="flex flex-col gap-2 border-t pt-4">
            <h2 id="kb-backlinks" className="text-sm font-semibold">
              {t.kb.backlinks.title}
            </h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {backlinks.articles.map((entry) => (
                <li key={`kb-${entry.id}`} className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`${articleBase}/${entry.id}` as Route} className="font-medium hover:underline">
                    {entry.title}
                  </Link>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {entry.kind === "runbook" ? t.kb.backlinks.runbook(entry.collectionName) : t.kb.backlinks.article(entry.collectionName)}
                  </span>
                </li>
              ))}
              {backlinks.documents.map((entry) => (
                <li key={`doc-${entry.id}`} className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/documents/${entry.id}` as Route} className="font-medium hover:underline">
                    {entry.title}
                  </Link>
                  <span className="text-xs text-[var(--muted-foreground)]">{t.kb.backlinks.document(entry.companyName)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
      {drawn && drawn.outline.length > 0 && <KbOutline items={drawn.outline} />}
    </div>
  );
}
