import { withApi } from "@/server/api/http";
import { kbReaderFor } from "@/server/api/kb";
import { serveArticleOriginal } from "@/server/services/kb-images";

export const dynamic = "force-dynamic";

/** The document an imported article was made from (e.g. the PDF), for a key that can read the article. */
export const GET = withApi<{ id: string }>("read", async ({ key, params, url, request }) =>
  serveArticleOriginal(request, params.id, kbReaderFor(key, url)),
);
