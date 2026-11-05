import { policyText } from "@/server/services/updates";
import { refuseUnlessUpdater } from "../auth";

export const dynamic = "force-dynamic";

/**
 * What the host updater reads on every run: the channel, the hour, whether an
 * administrator pressed "Update now", and which build answers. Plain
 * key=value lines, so the script needs no JSON parser.
 */
export async function GET(request: Request): Promise<Response> {
  const refused = refuseUnlessUpdater(request);
  if (refused) return refused;

  return new Response(await policyText(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
