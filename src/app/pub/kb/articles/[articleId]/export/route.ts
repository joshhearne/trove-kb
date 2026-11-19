import { admitPublicExportReader, TooManyRequestsError } from "@/server/kb/public";
import { isExportFormat } from "@/server/kb/export";
import { exportArticle, exportResponse } from "@/server/services/kb-export";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

/** An article on the public site as a file: `?format=pdf`, `md`, or `original`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ articleId: string }> },
): Promise<Response> {
  let reader;
  try {
    reader = await admitPublicExportReader();
  } catch (error) {
    if (error instanceof TooManyRequestsError) {
      return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
    }
    throw error;
  }
  if (!reader) return new Response("Not found", { status: 404 });

  const format = new URL(request.url).searchParams.get("format");
  if (!isExportFormat(format)) return new Response("Not found", { status: 404 });
  const { articleId } = await params;
  const file = await exportArticle(articleId, format, reader, await getI18n());
  return file ? exportResponse(file) : new Response("Not found", { status: 404 });
}
