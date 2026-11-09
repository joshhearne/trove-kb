import "server-only";
import { getCompanyScope, type CurrentUser } from "@/server/auth/session";
import { can } from "@/server/auth/roles";
import { grantsForUser } from "@/server/services/kb-grants";
import type { KbWriter } from "@/server/services/kb-write";

/** A signed-in person as a knowledge base writer: anywhere with kb.write, elsewhere where granted. */
export async function appWriter(user: CurrentUser): Promise<KbWriter> {
  return {
    via: "app",
    scope: await getCompanyScope(user),
    grants: await grantsForUser(user.id),
    userId: user.id,
    userName: user.name,
    admin: can(user.role, "kb.write"),
  };
}
