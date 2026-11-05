import { isUpdaterConfigured, updaterTokenMatches } from "@/server/services/updates";

/**
 * The host updater authenticates with TROVE_UPDATER_TOKEN, shared through the
 * server's .env by updater/install-updater.sh. Null when the request may go on.
 */
export function refuseUnlessUpdater(request: Request): Response | null {
  if (!isUpdaterConfigured()) {
    return Response.json(
      { error: { code: "not_enabled", message: "Set TROVE_UPDATER_TOKEN to enable the host updater" } },
      { status: 404 },
    );
  }
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!updaterTokenMatches(match?.[1]?.trim() ?? null)) {
    return Response.json(
      { error: { code: "unauthorized", message: "Wrong or missing updater token" } },
      { status: 401 },
    );
  }
  return null;
}
