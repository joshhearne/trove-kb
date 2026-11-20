"use server";

import { z } from "zod";
import { getCompanyScope, requireDocumentEditor, requireUser } from "@/server/auth/session";
import { appWriter } from "@/server/kb/app-writer";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import {
  createWikilinkTarget,
  NoMarkdownDocTypeError,
  suggestWikilinks,
  wikilinkContextSchema,
  type WikilinkSuggestion,
} from "@/server/services/wikilinks";

/** Pages to offer as a link is typed: what the person may open, with the caveats of linking to each. */
export async function suggestWikilinksAction(query: string, context: unknown): Promise<WikilinkSuggestion[]> {
  const user = await requireUser();
  const parsed = wikilinkContextSchema.safeParse(context);
  if (!parsed.success) return [];
  const scope = await getCompanyScope(user);
  return suggestWikilinks(z.string().max(200).catch("").parse(query), parsed.data, {
    scope,
    kb: { scope, via: "app", userId: user.id },
  });
}

/** Makes the page a link names, where the person writing may make one. */
export async function createWikilinkAction(
  title: string,
  context: unknown,
): Promise<{ ok: true; page: WikilinkSuggestion } | { ok: false; error: string }> {
  const parsed = wikilinkContextSchema.safeParse(context);
  if (!parsed.success) return { ok: false, error: "Not found" };
  try {
    const user = parsed.data.kind === "document" ? await requireDocumentEditor() : await requireUser();
    const scope = await getCompanyScope(user);
    const page = await createWikilinkTarget(z.string().max(500).parse(title), parsed.data, {
      userId: user.id,
      scope,
      writer: () => appWriter(user),
    });
    return { ok: true, page };
  } catch (error) {
    if (error instanceof NoMarkdownDocTypeError || error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof NotFoundError) return { ok: false, error: "Not found" };
    if (error instanceof z.ZodError) return { ok: false, error: error.issues[0]?.message ?? "Not valid" };
    throw error;
  }
}
