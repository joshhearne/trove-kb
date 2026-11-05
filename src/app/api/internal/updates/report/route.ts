import { ZodError } from "zod";
import { recordHostReport } from "@/server/services/updates";
import { parseHostReport } from "@/server/updates/report";
import { refuseUnlessUpdater } from "../auth";

export const dynamic = "force-dynamic";

/** The host updater's report after every run, form-encoded. */
export async function POST(request: Request): Promise<Response> {
  const refused = refuseUnlessUpdater(request);
  if (refused) return refused;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: { code: "invalid_body", message: "Send the report as a form" } },
      { status: 400 },
    );
  }

  try {
    await recordHostReport(parseHostReport(form));
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: { code: "validation_failed", message: error.issues[0]?.message ?? "Invalid report" } },
        { status: 400 },
      );
    }
    throw error;
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
