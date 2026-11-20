import "server-only";
import { wikilinkLabels, wikilinksToMarkdown } from "@/lib/wikilinks";
import { resolveWikilinks } from "@/server/services/wikilinks";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { kbImages } from "@/server/db/schema";
import { env } from "@/lib/env";
import { isWorkers } from "@/lib/runtime";
import { getStorage } from "@/server/storage";
import { contentDisposition } from "@/server/storage/filename";
import { rewriteReferences } from "@/server/kb/images";
import { publicAddressFor } from "@/server/kb/share";
import { articlePdf, stampPdf, type ExportMarker } from "@/server/kb/export-pdf";
import {
  exportFilename,
  exportOptions,
  markdownExport,
  withoutLeadingTitle,
  withoutStepIds,
  type ExportFormat,
} from "@/server/kb/export";
import { getArticle, type ArticleDetail, type KbReader } from "@/server/services/kb";
import { picturesOf } from "@/server/services/kb-images";
import { originalOf } from "@/server/services/kb-import";
import { getInstanceBranding } from "@/server/services/branding";
import { formatDateTime } from "@/i18n/format";
import type { Locale } from "@/i18n/locales";
import type { Messages } from "@/i18n";

/**
 * An article exported as a file the reader keeps: a PDF, its Markdown, or
 * the document it came from. Read through the reader's own `KbReader`, so
 * an article they cannot open is not found, and on the public site only
 * what the public site shows can be exported.
 *
 * Every PDF carries a footer on each page, and every Markdown file a front
 * matter block, naming the instance, the collection, the article, where it
 * can be read, and when it was exported.
 */

export type ExportedFile = { body: Uint8Array; mime: string; filename: string; inline: boolean };

const IMAGE_SCHEME = "trove-image:";

/**
 * Where the article can be read, and where its pictures are fetched from:
 * the public site when it is there, the app otherwise.
 */
async function addressOf(article: ArticleDetail): Promise<{ url: string; images: string }> {
  const published = await publicAddressFor({
    id: article.id,
    collectionPublic: article.collectionPublic,
    publicHidden: article.publicHidden,
  });
  if (published) return { url: published, images: `${published}/images` };
  const app = env.APP_URL.replace(/\/+$/, "");
  return { url: `${app}/kb/articles/${article.id}`, images: `${app}/api/kb/articles/${article.id}/images` };
}

/** A picture the PDF can embed: PNG and JPEG as they are, anything else turned into PNG where sharp runs. */
async function embeddable(bytes: Buffer, mime: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (mime === "image/png" || mime === "image/jpeg") return { bytes: new Uint8Array(bytes), mime };
  if (!mime.startsWith("image/") || isWorkers()) return null;
  // Native, so resolved at runtime and never bundled.
  const specifier = "sharp";
  try {
    type Sharp = (typeof import("sharp"))["default"];
    const sharp = ((await import(/* webpackIgnore: true */ specifier)) as { default: Sharp }).default;
    return { bytes: new Uint8Array(await sharp(bytes).png().toBuffer()), mime: "image/png" };
  } catch {
    return null;
  }
}

export async function exportArticle(
  articleId: string,
  format: ExportFormat,
  reader: KbReader,
  i18n: { locale: Locale; messages: Messages },
): Promise<ExportedFile | null> {
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) return null;
  const article = await getArticle(articleId, reader);
  if (!article) return null;
  const original = originalOf(article.metadata);
  if (format === "original" && (!original || original.mime === "application/pdf")) return null;

  const t = i18n.messages.kb.export;
  const [branding, { url, images: imageBase }] = await Promise.all([getInstanceBranding(), addressOf(article)]);
  const exportedAt = new Date();
  const instance = branding.name?.trim() || "Trove KB";
  const marker: ExportMarker = {
    place: article.category
      ? [article.category, article.subcategory].filter(Boolean).join(" › ")
      : article.collectionName,
    url,
    sourceUrl: article.sourceUrl,
    exportedAt: formatDateTime(exportedAt, i18n.locale),
    labels: { exported: t.exported, source: t.source, page: t.page },
  };

  // The kept document, as it came: a Word file or a saved page has no place for a footer.
  if (format === "original" && original) {
    const bytes = await (await getStorage()).get(original.key);
    return { body: new Uint8Array(bytes), mime: original.mime, filename: original.name, inline: false };
  }

  // Links to other pages, as this reader may open them: in a file, by full address.
  const links = await resolveWikilinks([article.body], {
    scope: reader.scope,
    kb: reader,
    publicSite: reader.via === "public",
    base: reader.via === "public" ? new URL(url).origin : env.APP_URL.replace(/\/+$/, ""),
  });

  if (format === "md") {
    const pictures = await picturesOf(article);
    const body =
      article.format === "markdown"
        ? rewriteReferences(wikilinksToMarkdown(article.body, links), article.sourcePath, (path) => {
            const id = pictures.get(path);
            return id ? `${imageBase}/${id}` : null;
          })
        : article.body;
    const text = markdownExport({
      title: article.title,
      body,
      collection: article.collectionName,
      category: article.category,
      subcategory: article.subcategory,
      kind: article.kind,
      sourceUrl: article.sourceUrl,
      url,
      articleId: article.id,
      instance,
      exportedAt,
    });
    return {
      body: new TextEncoder().encode(text),
      mime: "text/markdown; charset=utf-8",
      filename: exportFilename(article.title, "md"),
      inline: false,
    };
  }

  // A PDF: the one the article came from, footer stamped on, when there is one.
  if (original?.mime === "application/pdf") {
    const bytes = await (await getStorage()).get(original.key);
    try {
      return {
        body: await stampPdf(new Uint8Array(bytes), marker),
        mime: "application/pdf",
        filename: original.name.toLowerCase().endsWith(".pdf") ? original.name : exportFilename(article.title, "pdf"),
        inline: false,
      };
    } catch (error) {
      // An encrypted or damaged file cannot be stamped: the PDF is made from its text instead.
      console.error(`trove-kb: could not stamp the PDF of article ${article.id}`, error);
    }
  }

  const pictures = await picturesOf(article);
  const body =
    article.format === "markdown"
      ? rewriteReferences(withoutLeadingTitle(withoutStepIds(wikilinkLabels(article.body, links)), article.title), article.sourcePath, (path) => {
          const id = pictures.get(path);
          return id ? `${IMAGE_SCHEME}${id}` : null;
        })
      : article.body;
  const ids = [...new Set(pictures.values())];
  const rows = ids.length
    ? await db
        .select({ id: kbImages.id, storageKey: kbImages.storageKey, mimeType: kbImages.mimeType })
        .from(kbImages)
        .where(and(eq(kbImages.collectionId, article.collectionId), inArray(kbImages.id, ids)))
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const storage = await getStorage();

  const pdf = await articlePdf(
    {
      title: article.title,
      body: article.extraction === "unextracted" ? t.unextracted : body,
      format: article.extraction === "unextracted" ? "text" : article.format,
      meta: [article.collectionName, article.category, article.subcategory].filter((part): part is string => !!part),
      instance,
    },
    marker,
    // Only the collection's own pictures are drawn; an address elsewhere is never fetched.
    async (src) => {
      if (!src.startsWith(IMAGE_SCHEME)) return null;
      const row = byId.get(src.slice(IMAGE_SCHEME.length));
      if (!row) return null;
      try {
        return await embeddable(await storage.get(row.storageKey), row.mimeType);
      } catch {
        return null;
      }
    },
  );
  return { body: pdf, mime: "application/pdf", filename: exportFilename(article.title, "pdf"), inline: false };
}

/** The file as a download. Never cached: each one carries the moment it was exported. */
export function exportResponse(file: ExportedFile): Response {
  return new Response(file.body as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.body.byteLength),
      "Content-Disposition": contentDisposition(file.filename, file.inline),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}

export { exportOptions };
