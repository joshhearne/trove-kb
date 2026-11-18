import { ZodError } from "zod";
import { refuse, requireUserRequest } from "@/server/kb/admin-route";
import { appWriter } from "@/server/kb/app-writer";
import { RunbookStepError } from "@/server/kb/runbook";
import { MAX_ENTRY_BYTES } from "@/server/kb/zip";
import { ForbiddenError, NotFoundError } from "@/server/services/errors";
import { NotAcceptedFileError, uploadArticle } from "@/server/services/kb-curate";

export const dynamic = "force-dynamic";

function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * A new article made from one uploaded file, from the new-article page: the
 * file is read as an import reads it and kept beside the article, filed under
 * the title, category and section given with it.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await requireUserRequest(request);
  if ("response" in guard) return guard.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400, "invalid", "Send the file as a form upload");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return refuse(400, "invalid", "Choose a file");
  if (file.size > MAX_ENTRY_BYTES) return refuse(413, "too_large", "The file is too large");

  try {
    const articleId = await uploadArticle(
      {
        collectionId: field(form, "collectionId") ?? "",
        title: field(form, "title"),
        category: field(form, "category"),
        subcategory: field(form, "subcategory"),
        kind: form.get("runbook") === "on" ? "runbook" : "article",
        publicHidden: form.get("internalOnly") === "on",
      },
      file.name,
      Buffer.from(await file.arrayBuffer()),
      await appWriter(guard.user),
    );
    return Response.json({ id: articleId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return refuse(400, "invalid", error.issues[0]?.message ?? "That is not valid");
    if (error instanceof NotAcceptedFileError) return refuse(415, "not_accepted", error.message);
    if (error instanceof RunbookStepError) return refuse(422, "runbook", error.message);
    if (error instanceof NotFoundError) return refuse(404, "not_found", "Not found");
    if (error instanceof ForbiddenError) return refuse(403, "forbidden", error.message);
    throw error;
  }
}
