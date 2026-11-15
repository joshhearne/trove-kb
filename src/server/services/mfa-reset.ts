import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  mfaPasskeys,
  mfaRecoveryCodes,
  mfaTotp,
  sessions,
  users,
} from "@/server/db/schema";

/**
 * What resetting someone's second step means, in one place: every factor and
 * recovery code gone, the guessing lock lifted, the grace period started
 * afresh, and their sessions no longer verified. Shared by Admin -> Users
 * (resetMfa) and the server console (scripts/reset-mfa.ts), so it imports
 * nothing server-only. The caller runs it in a transaction and writes the
 * audit entry.
 *
 * Returns what was removed, or null when there is no such user.
 */
export async function clearSecondStep(
  tx: Pick<NodePgDatabase, "select" | "delete" | "update">,
  userId: string,
): Promise<{
  email: string;
  totp: number;
  passkeys: number;
  recoveryCodes: number;
} | null> {
  const [row] = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  const totp = await tx
    .delete(mfaTotp)
    .where(eq(mfaTotp.userId, userId))
    .returning({ id: mfaTotp.userId });
  const passkeys = await tx
    .delete(mfaPasskeys)
    .where(eq(mfaPasskeys.userId, userId))
    .returning({ id: mfaPasskeys.id });
  const codes = await tx
    .delete(mfaRecoveryCodes)
    .where(eq(mfaRecoveryCodes.userId, userId))
    .returning({ id: mfaRecoveryCodes.id });
  await tx
    .update(users)
    .set({ mfaFailures: 0, mfaLockedUntil: null, mfaDeadline: null })
    .where(eq(users.id, userId));
  await tx
    .update(sessions)
    .set({ mfaVerifiedAt: null })
    .where(eq(sessions.userId, userId));
  return {
    email: row.email,
    totp: totp.length,
    passkeys: passkeys.length,
    recoveryCodes: codes.length,
  };
}
