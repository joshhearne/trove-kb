import { refuse, requireAdminRequest } from "@/server/kb/admin-route";
import { appWriter } from "@/server/kb/app-writer";
import { MAX_ENTRY_BYTES } from "@/server/kb/zip";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { NotAcceptedFileError, replaceArticleFile } from "@/server/services/kb-curate";

export const dynamic = "force-dynamic";

/**
 * A new version of the file an article was made from, uploaded by an
 * administrator: the text is read again, and the old file and text stay in
 * the article's history.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ articleId: string }> },
): Promise<Response> {
  const guard = await requireAdminRequest(request);
  if ("response" in guard) return guard.response;
  const { articleId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) return refuse(404, "not_found", "Not found");

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return refuse(400, "invalid", "Send the file as a form upload");
  }
  if (!(file instanceof File) || file.size === 0) return refuse(400, "invalid", "Choose a file");
  if (file.size > MAX_ENTRY_BYTES) return refuse(413, "too_large", "The file is too large");

  try {
    await replaceArticleFile(articleId, file.name, Buffer.from(await file.arrayBuffer()), await appWriter(guard.user));
  } catch (error) {
    if (error instanceof NotAcceptedFileError) return refuse(415, "not_accepted", error.message);
    if (error instanceof NotFoundError) return refuse(404, "not_found", "Not found");
    if (error instanceof ForbiddenError) return refuse(403, "forbidden", error.message);
    throw error;
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
