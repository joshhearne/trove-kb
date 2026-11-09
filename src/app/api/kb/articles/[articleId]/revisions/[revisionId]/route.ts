import { getCompanyScope } from "@/server/auth/session";
import { refuse, requireAdminRequest } from "@/server/kb/admin-route";
import { getArticle } from "@/server/services/kb";
import { getRevision } from "@/server/services/kb-revisions";
import { getStorage } from "@/server/storage";
import { contentDisposition } from "@/server/storage/filename";

export const dynamic = "force-dynamic";

/**
 * The file an article had before a new version replaced it, from its history.
 * Always a download, never drawn here.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ articleId: string; revisionId: string }> },
): Promise<Response> {
  const guard = await requireAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { articleId, revisionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId) || !/^\d+$/.test(revisionId)) return refuse(404, "not_found", "Not found");

  const article = await getArticle(articleId, {
    scope: await getCompanyScope(guard.user),
    via: "app",
    userId: guard.user.id,
  });
  const revision = article ? await getRevision(articleId, Number(revisionId)) : null;
  if (!revision?.original) return refuse(404, "not_found", "Not found");

  let body: Buffer;
  try {
    body = await (await getStorage()).get(revision.original.key);
  } catch {
    return new Response("The file is missing from storage", { status: 502 });
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": revision.original.mime,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": contentDisposition(revision.original.name, false),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
