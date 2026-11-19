import { getCompanyScope, getCurrentUser } from "@/server/auth/session";
import { isExportFormat } from "@/server/kb/export";
import { exportArticle, exportResponse } from "@/server/services/kb-export";
import { getI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

/** An article as a file for a reader who has signed in: `?format=pdf`, `md`, or `original`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ articleId: string }> },
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const format = new URL(request.url).searchParams.get("format");
  if (!isExportFormat(format)) return new Response("Not found", { status: 404 });
  const { articleId } = await params;
  const file = await exportArticle(
    articleId,
    format,
    { scope: await getCompanyScope(user), via: "app", userId: user.id },
    await getI18n(),
  );
  return file ? exportResponse(file) : new Response("Not found", { status: 404 });
}
