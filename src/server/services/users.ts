import "server-only";
import { z } from "zod";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { userCompanies, users } from "@/server/db/schema";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/companies";
import { type Role, isAdministrator, loadRoles } from "@/server/auth/roles";
import { roleExists } from "@/server/services/roles";
import { ALL_COMPANIES, only, type CompanyScope } from "@/server/auth/company-scope";
import { SECRET_STYLES, type SecretStyle } from "@/lib/secret-style";
import { EDITOR_VIEWS, type EditorView } from "@/lib/editor-view";

/**
 * Minimal user administration. Phase 6 needs it because revealing a secret
 * requires `can_reveal_secrets`, and nothing else could grant that.
 */

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  canRevealSecrets: boolean;
  allCompanies: boolean;
  companyIds: string[];
  createdAt: Date;
};

export type UserAccess = { allCompanies: boolean; companyIds: string[] };

export async function listUsers(): Promise<UserRow[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      canRevealSecrets: users.canRevealSecrets,
      allCompanies: users.allCompanies,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.email));

  const grants = rows.length
    ? await db
        .select({ userId: userCompanies.userId, companyId: userCompanies.companyId })
        .from(userCompanies)
        .where(
          inArray(
            userCompanies.userId,
            rows.map((row) => row.id),
          ),
        )
    : [];

  const byUser = new Map<string, string[]>();
  for (const grant of grants) {
    byUser.set(grant.userId, [...(byUser.get(grant.userId) ?? []), grant.companyId]);
  }

  return rows.map((row) => ({ ...row, companyIds: byUser.get(row.id) ?? [] }));
}

/**
 * What a user may see, read fresh from the database on every request rather
 * than from the session. A grant revoked by an admin has to take effect on the
 * user's next page load, not whenever their session happens to be reissued.
 */
export async function companyScopeForUser(user: {
  id: string;
  role: string;
}): Promise<CompanyScope> {
  // Admins are who grant access; restricting them would lock the instance.
  await loadRoles();
  if (isAdministrator(user.role)) return ALL_COMPANIES;

  const [row] = await db
    .select({ allCompanies: users.allCompanies })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  // A user row that has gone away sees nothing.
  if (!row) return only([]);
  if (row.allCompanies) return ALL_COMPANIES;

  const granted = await db
    .select({ companyId: userCompanies.companyId })
    .from(userCompanies)
    .where(eq(userCompanies.userId, user.id));

  return only(granted.map((grant) => grant.companyId));
}

/** Replaces a user's grants wholesale, which is how the admin screen edits them. */
export async function setUserCompanies(
  id: string,
  access: UserAccess,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ allCompanies: access.allCompanies, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) throw new NotFoundError("User");

    await tx.delete(userCompanies).where(eq(userCompanies.userId, id));

    // Grants are kept even when "all companies" is on, so turning it back off
    // restores the list the admin chose rather than emptying it.
    if (access.companyIds.length > 0) {
      await tx
        .insert(userCompanies)
        .values(access.companyIds.map((companyId) => ({ userId: id, companyId })));
    }

    await writeAudit(
      {
        userId: actorId,
        action: "user.companies_changed",
        entity: "user",
        entityId: id,
        detail: { allCompanies: access.allCompanies, companyIds: access.companyIds },
      },
      tx,
    );
  });
}

export async function setUserRole(id: string, role: Role, actorId: string): Promise<void> {
  if (!(await roleExists(role))) throw new Error("Unknown role");

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) throw new NotFoundError("User");

    await writeAudit(
      { userId: actorId, action: "user.role_changed", entity: "user", entityId: id, detail: { role } },
      tx,
    );
  });
}

export async function setCanRevealSecrets(
  id: string,
  canReveal: boolean,
  actorId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ canRevealSecrets: canReveal, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) throw new NotFoundError("User");

    await writeAudit(
      {
        userId: actorId,
        action: canReveal ? "user.secrets_granted" : "user.secrets_revoked",
        entity: "user",
        entityId: id,
      },
      tx,
    );
  });
}

export const secretStyleSchema = z.enum(SECRET_STYLES);

export const editorViewSchema = z.enum(EDITOR_VIEWS);

/** A person's own choice of how a Markdown editor opens. No audit: it changes nothing anyone else sees. */
export async function setEditorView(id: string, view: EditorView): Promise<void> {
  const [row] = await db
    .update(users)
    .set({ editorView: editorViewSchema.parse(view), updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) throw new NotFoundError("User");
}

/** A person's own choice of how secrets are shown to them. No audit: it changes nothing anyone else sees. */
export async function setSecretStyle(id: string, style: SecretStyle): Promise<void> {
  const [row] = await db
    .update(users)
    .set({ secretStyle: secretStyleSchema.parse(style), updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) throw new NotFoundError("User");
}

export const provisionUserSchema = z.object({
  email: z.email().trim().toLowerCase().max(320),
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(40).default("tech"),
  allCompanies: z.boolean().optional(),
});

/**
 * An account for a person who has not signed in yet, so a collection can be
 * granted to them before their first visit. No password is set: they sign in
 * through single sign-on, or an administrator sets a temporary password. An
 * account that already exists under the email is returned as it is.
 */
export async function provisionUser(
  input: z.input<typeof provisionUserSchema>,
  actor: { userId?: string; apiKeyId?: string; apiKeyName?: string },
): Promise<{ id: string; created: boolean }> {
  const data = provisionUserSchema.parse(input);
  if (!(await roleExists(data.role))) throw new Error("Unknown role");
  await loadRoles();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1);
  if (existing) return { id: existing.id, created: false };

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        name: data.name,
        email: data.email,
        role: data.role,
        emailVerified: false,
        allCompanies: data.allCompanies ?? isAdministrator(data.role),
      })
      .returning({ id: users.id });
    if (!user) throw new Error("Failed to create the user");
    await writeAudit(
      {
        ...(actor.userId ? { userId: actor.userId } : {}),
        action: "user.created",
        entity: "user",
        entityId: user.id,
        detail: {
          email: data.email,
          role: data.role,
          ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId, apiKeyName: actor.apiKeyName } : {}),
        },
      },
      tx,
    );
    return { id: user.id, created: true };
  });
}
