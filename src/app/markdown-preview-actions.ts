"use server";

import { requireUser } from "@/server/auth/session";
import { renderArticleMarkdown, renderMarkdown } from "@/server/fields/render";
import { embedVideos } from "@/server/kb/video";

/** More than any article or field holds; a preview of more is not drawn. */
const MAX_PREVIEW_CHARS = 1_000_000;

export type PreviewFlavor = "field" | "article";

/**
 * Markdown drawn exactly as the saved page draws it, for an editor's
 * preview: a document field as a field is, a knowledge base article with its
 * outlines and videos. Sanitized like everything else; nothing is stored.
 */
export async function previewMarkdownAction(source: string, flavor: PreviewFlavor): Promise<string> {
  await requireUser();
  if (typeof source !== "string" || source.length > MAX_PREVIEW_CHARS) return "";
  return flavor === "article" ? embedVideos(renderArticleMarkdown(source)) : renderMarkdown(source);
}
