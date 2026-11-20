import { json, withApi } from "@/server/api/http";
import { kbReaderFor, reactionsAllowed, readerKeyFrom, serializeArticle } from "@/server/api/kb";
import { NotFoundError } from "@/server/services/errors";
import { getArticle } from "@/server/services/kb";

export const dynamic = "force-dynamic";

/** One article in full: its body, its steps when a runbook, and with X-Trove-Reader what that reader made of it. */
export const GET = withApi<{ id: string }>("read", async ({ key, params, url, request }) => {
  const reader = kbReaderFor(key, url);
  const article = await getArticle(params.id, reader);
  if (!article) throw new NotFoundError("Article");
  return json(await serializeArticle(article, reactionsAllowed(key, article.collectionId) ? readerKeyFrom(request) : null, reader));
});
