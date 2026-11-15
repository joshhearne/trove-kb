/**
 * Resets someone's second step from the server console: for a sole
 * administrator who has lost every factor, with no other administrator to do
 * it from Admin -> Users. Does exactly what that button does (every factor and
 * recovery code removed, sessions no longer verified, the week to enroll
 * started again) and writes the same audit entry, marked as done from the
 * console. Needs shell access to the server, so it opens nothing on the web.
 *
 *   Docker:     docker compose exec app node dist/reset-mfa.js <email>
 *   Bare metal: cd current && node --env-file=../.env dist/reset-mfa.js <email>
 *   Source:     npx tsx scripts/reset-mfa.ts <email>
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auditLog, users } from "../src/server/db/schema";
import { clearSecondStep } from "../src/server/services/mfa-reset";

const email = process.argv[2]?.trim();
if (!email || email.startsWith("-")) {
  console.error("usage: reset-mfa <email>");
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

const [user] = await db
  .select({ id: users.id, email: users.email, role: users.role })
  .from(users)
  .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
  .limit(1);
if (!user) {
  console.error(`No account with the email ${email}`);
  await pool.end();
  process.exit(1);
}

const cleared = await db.transaction(async (tx) => {
  const result = await clearSecondStep(tx, user.id);
  if (!result) return null;
  await tx.insert(auditLog).values({
    userId: null,
    action: "mfa.reset",
    entity: "user",
    entityId: user.id,
    detail: { email: result.email, via: "console" },
  });
  return result;
});
await pool.end();

if (!cleared) {
  console.error(`No account with the email ${email}`);
  process.exit(1);
}
console.log(
  `Second step reset for ${cleared.email} (${user.role}): removed ${cleared.totp} authenticator app, ` +
    `${cleared.passkeys} passkey(s), ${cleared.recoveryCodes} recovery code(s). ` +
    `They sign in with their password and enroll again; administrators have a week.`,
);
process.exit(0);
