import "server-only";
import { env } from "@/lib/env";
import { getCurrentUser, type CurrentUser } from "@/server/auth/session";
import { isAdministrator } from "@/server/auth/roles";

/**
 * The guard on the import routes. They are called by the administration page,
 * as the signed-in administrator, so they take a session rather than an API
 * key — and a request that changes anything has to come from this site.
 */

export function refuse(status: number, code: string, message: string, extra: object = {}): Response {
  return Response.json(
    { error: { code, message, ...extra } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // A browser always says where a cross-site request came from.
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    const presented = new URL(origin).origin;
    return presented === new URL(env.APP_URL).origin || presented === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function requireAdminRequest(
  request: Request,
): Promise<{ user: CurrentUser } | { response: Response }> {
  if (request.method !== "GET" && !sameOrigin(request)) {
    return { response: refuse(403, "forbidden", "Origin not allowed") };
  }

  const user = await getCurrentUser();
  if (!user) return { response: refuse(401, "unauthorized", "Sign in first") };
  // Not found rather than forbidden: the routes are nobody else's business.
  if (!isAdministrator(user.role)) return { response: refuse(404, "not_found", "Not found") };

  return { user };
}

/**
 * The same guard for a route anyone signed in may call, such as writing an
 * article where they hold a grant: whether they may is the service's to say.
 */
export async function requireUserRequest(
  request: Request,
): Promise<{ user: CurrentUser } | { response: Response }> {
  if (request.method !== "GET" && !sameOrigin(request)) {
    return { response: refuse(403, "forbidden", "Origin not allowed") };
  }

  const user = await getCurrentUser();
  if (!user) return { response: refuse(401, "unauthorized", "Sign in first") };
  return { user };
}
