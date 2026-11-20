"use server";

import { getCompanyScope, requireUser } from "@/server/auth/session";
import { renderArticleMarkdown, renderMarkdown } from "@/server/fields/render";
import { embedVideos } from "@/server/kb/video";
import {
  flaggedWikilinks,
  resolveWikilinks,
  wikilinkContextSchema,
  type WikilinkFlag,
} from "@/server/services/wikilinks";

/** More than any article or field holds; a preview of more is not drawn. */
const MAX_PREVIEW_CHARS = 1_000_000;

export type PreviewFlavor = "field" | "article";

export type Preview = {
  html: string;
  /** Pages linked to that some readers of this page may not be able to open. */
  flagged: { title: string; flags: WikilinkFlag[] }[];
};

/**
 * Markdown drawn exactly as the saved page draws it, for an editor's
 * preview: a document field as a field is, a knowledge base article with its
 * outlines and videos, and its links to other pages as the author may open
 * them. Sanitized like everything else; nothing is stored.
 */
export async function previewMarkdownAction(source: string, flavor: PreviewFlavor, context?: unknown): Promise<Preview> {
  const user = await requireUser();
  if (typeof source !== "string" || source.length > MAX_PREVIEW_CHARS) return { html: "", flagged: [] };
  const scope = await getCompanyScope(user);
  const reader = { scope, kb: { scope, via: "app" as const, userId: user.id } };
  const links = await resolveWikilinks([source], reader);
  const html = flavor === "article" ? embedVideos(renderArticleMarkdown(source, links)) : renderMarkdown(source, links);
  const parsed = wikilinkContextSchema.safeParse(context);
  const flagged = parsed.success ? await flaggedWikilinks(source, parsed.data, reader) : [];
  return { html, flagged };
}
