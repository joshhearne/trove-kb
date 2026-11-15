import "server-only";
import { clearSecondStep } from "@/server/services/mfa-reset";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { toString as qrToString } from "qrcode";
import { db } from "@/server/db";
import {
  mfaPasskeys,
  mfaRecoveryCodes,
  mfaTotp,
  sessions,
  users,
  verifications,
} from "@/server/db/schema";
import { env } from "@/lib/env";
import { writeAudit } from "@/server/services/audit";
import { NotFoundError } from "@/server/services/errors";
import { open, seal } from "@/server/auth/secret-box";
import { generateRecoveryCodes, hashRecoveryCode } from "@/server/auth/recovery-codes";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/server/auth/totp";

/**
 * Second factors. A person may enroll an authenticator app, any number of
 * passkeys, or both, and holds ten recovery codes for the day none of those
 * is to hand. Administrators must enroll something; everyone else is offered
 * it. The seed of the app is sealed with a key derived from the instance
 * secret; a passkey's public key is its own; a recovery code is a hash.
 *
 * Guessing is throttled per person and every wrong answer is logged.
 */

export const MFA_GRACE_DAYS = 7;
/** How long a verified session counts as verified for the sensitive pages. */
export const STEP_UP_MINUTES = 15;
export const MFA_LOCK_AFTER = 10;
export const MFA_LOCK_MINUTES = 15;
const ATTEMPTS_PER_MINUTE = 5;
const PENDING_MINUTES = 10;

const TOTP_PURPOSE = "mfa-totp";
const ISSUER = "Trove KB";

export type PasskeyRow = {
  id: string;
  label: string;
  deviceType: string;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type MfaStatus = {
  totp: { enrolledAt: Date; lastUsedAt: Date | null } | null;
  passkeys: PasskeyRow[];
  recoveryCodesLeft: number;
  /** Anything at all enrolled. */
  enrolled: boolean;
};

export async function mfaStatus(userId: string): Promise<MfaStatus> {
  const [[totp], passkeys, [codes]] = await Promise.all([
    db
      .select({ enrolledAt: mfaTotp.enrolledAt, lastUsedAt: mfaTotp.lastUsedAt })
      .from(mfaTotp)
      .where(eq(mfaTotp.userId, userId))
      .limit(1),
    db
      .select({
        id: mfaPasskeys.id,
        label: mfaPasskeys.label,
        deviceType: mfaPasskeys.deviceType,
        backedUp: mfaPasskeys.backedUp,
        createdAt: mfaPasskeys.createdAt,
        lastUsedAt: mfaPasskeys.lastUsedAt,
      })
      .from(mfaPasskeys)
      .where(eq(mfaPasskeys.userId, userId))
      .orderBy(mfaPasskeys.createdAt),
    db
      .select({ left: sql<number>`count(*)::int` })
      .from(mfaRecoveryCodes)
      .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt))),
  ]);
  return {
    totp: totp ?? null,
    passkeys,
    recoveryCodesLeft: codes?.left ?? 0,
    enrolled: !!totp || passkeys.length > 0,
  };
}

/** Cheaper than the whole status, for the check every request makes. */
export async function hasSecondFactor(userId: string): Promise<boolean> {
  const [row] = await db
    .select({
      any: sql<boolean>`exists(select 1 from ${mfaTotp} where ${mfaTotp.userId} = ${userId})
        or exists(select 1 from ${mfaPasskeys} where ${mfaPasskeys.userId} = ${userId})`,
    })
    .from(sql`(select 1) as one`);
  return row?.any === true;
}

/* ---------- The grace period ---------- */

/**
 * An administrator who has enrolled nothing gets a week from the first time
 * this is asked. The deadline is set once and not moved.
 */
export async function mfaDeadlineFor(userId: string): Promise<Date> {
  return (await mfaDeadline(userId)).deadline;
}

/** The deadline and whether it has passed, decided here so a page need not ask the clock. */
export async function mfaDeadline(userId: string): Promise<{ deadline: Date; overdue: boolean }> {
  const deadline = await deadlineFor(userId);
  return { deadline, overdue: deadline.getTime() <= Date.now() };
}

async function deadlineFor(userId: string): Promise<Date> {
  const [row] = await db
    .select({ deadline: users.mfaDeadline })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (row?.deadline) return row.deadline;

  const deadline = new Date(Date.now() + MFA_GRACE_DAYS * 86_400_000);
  await db
    .update(users)
    .set({ mfaDeadline: deadline })
    .where(and(eq(users.id, userId), isNull(users.mfaDeadline)));
  return deadline;
}

/* ---------- Pending values, kept server-side for a few minutes ---------- */

async function keep(identifier: string, value: string): Promise<void> {
  await db.delete(verifications).where(eq(verifications.identifier, identifier));
  await db.insert(verifications).values({
    identifier,
    value,
    expiresAt: new Date(Date.now() + PENDING_MINUTES * 60_000),
  });
}

/** Reads a pending value once; it is gone afterwards, whatever happens next. */
async function take(identifier: string): Promise<string | null> {
  const [row] = await db
    .delete(verifications)
    .where(and(eq(verifications.identifier, identifier), gt(verifications.expiresAt, new Date())))
    .returning({ value: verifications.value });
  return row?.value ?? null;
}

/* ---------- Authenticator app ---------- */

export type TotpEnrollment = { secret: string; otpauth: string; qrSvg: string };

/** A new seed, shown as a code to scan and as letters to type. Nothing is enrolled until a code proves it. */
export async function beginTotpEnrollment(user: { id: string; email: string }): Promise<TotpEnrollment> {
  const secret = generateTotpSecret();
  const otpauth = otpauthUrl(secret, user.email, ISSUER);
  await keep(`totp-enroll:${user.id}`, seal(secret, env.AUTH_SECRET, TOTP_PURPOSE));
  const qrSvg = await qrToString(otpauth, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, otpauth, qrSvg };
}

export class WrongCodeError extends Error {
  constructor() {
    super("That code is not right");
    this.name = "WrongCodeError";
  }
}

export class NothingPendingError extends Error {
  constructor() {
    super("Start again: that setup has expired");
    this.name = "NothingPendingError";
  }
}

/**
 * The code from the app proves the seed was scanned; only then is it kept.
 * The first factor enrolled brings recovery codes with it, shown once.
 */
export async function confirmTotpEnrollment(
  user: { id: string },
  code: string,
): Promise<{ recoveryCodes: string[] | null }> {
  const [pending] = await db
    .select({ value: verifications.value })
    .from(verifications)
    .where(and(eq(verifications.identifier, `totp-enroll:${user.id}`), gt(verifications.expiresAt, new Date())))
    .limit(1);
  const secret = pending ? open(pending.value, env.AUTH_SECRET, TOTP_PURPOSE) : null;
  if (!secret) throw new NothingPendingError();

  const result = verifyTotp(secret, code);
  if (!result.ok) throw new WrongCodeError();
  await take(`totp-enroll:${user.id}`);

  const hadFactor = await hasSecondFactor(user.id);
  return db.transaction(async (tx) => {
    await tx
      .insert(mfaTotp)
      .values({ userId: user.id, secretEncrypted: seal(secret, env.AUTH_SECRET, TOTP_PURPOSE), lastUsedStep: result.step })
      .onConflictDoUpdate({
        target: mfaTotp.userId,
        set: {
          secretEncrypted: seal(secret, env.AUTH_SECRET, TOTP_PURPOSE),
          lastUsedStep: result.step,
          enrolledAt: new Date(),
          lastUsedAt: null,
        },
      });
    await writeAudit({ userId: user.id, action: "mfa.totp_enrolled", entity: "user", entityId: user.id }, tx);
    const recoveryCodes = hadFactor ? null : await issueRecoveryCodes(user.id, tx);
    return { recoveryCodes };
  });
}

export async function removeTotp(user: { id: string }): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(mfaTotp).where(eq(mfaTotp.userId, user.id));
    await writeAudit({ userId: user.id, action: "mfa.totp_removed", entity: "user", entityId: user.id }, tx);
  });
}

/* ---------- Recovery codes ---------- */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function issueRecoveryCodes(userId: string, tx: Tx): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  await tx.insert(mfaRecoveryCodes).values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })));
  await writeAudit({ userId, action: "mfa.recovery_codes_issued", entity: "user", entityId: userId }, tx);
  return codes;
}

/** A fresh set, which is the only way to see any again. The old set stops working. */
export async function regenerateRecoveryCodes(user: { id: string }): Promise<string[]> {
  return db.transaction((tx) => issueRecoveryCodes(user.id, tx));
}

/* ---------- Passkeys ---------- */

function relyingParty(): { rpID: string; origin: string } {
  const url = new URL(env.APP_URL);
  return { rpID: url.hostname, origin: url.origin };
}

async function userPasskeys(userId: string) {
  return db
    .select({
      id: mfaPasskeys.id,
      credentialId: mfaPasskeys.credentialId,
      publicKey: mfaPasskeys.publicKey,
      counter: mfaPasskeys.counter,
      transports: mfaPasskeys.transports,
    })
    .from(mfaPasskeys)
    .where(eq(mfaPasskeys.userId, userId));
}

function transportsOf(stored: string): AuthenticatorTransport[] | undefined {
  const list = stored.split(",").filter(Boolean) as AuthenticatorTransport[];
  return list.length > 0 ? list : undefined;
}

type AuthenticatorTransport = NonNullable<
  NonNullable<PublicKeyCredentialRequestOptionsJSON["allowCredentials"]>[number]["transports"]
>[number];

export async function beginPasskeyRegistration(user: {
  id: string;
  email: string;
  name: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = relyingParty();
  const existing = await userPasskeys(user.id);
  const options = await generateRegistrationOptions({
    rpName: ISSUER,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({
      id: row.credentialId,
      transports: transportsOf(row.transports),
    })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await keep(`passkey-register:${user.id}`, options.challenge);
  return options;
}

export class PasskeyRefusedError extends Error {
  constructor() {
    super("The passkey could not be verified");
    this.name = "PasskeyRefusedError";
  }
}

/** The browser's answer, checked against the challenge that was set, and kept under the name given. */
export async function finishPasskeyRegistration(
  user: { id: string },
  response: RegistrationResponseJSON,
  label: string,
): Promise<{ recoveryCodes: string[] | null }> {
  const challenge = await take(`passkey-register:${user.id}`);
  if (!challenge) throw new NothingPendingError();

  const { rpID, origin } = relyingParty();
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    throw new PasskeyRefusedError();
  }
  if (!verified.verified) throw new PasskeyRefusedError();

  const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;
  const hadFactor = await hasSecondFactor(user.id);
  const name = label.trim().slice(0, 100) || "Passkey";

  return db.transaction(async (tx) => {
    await tx.insert(mfaPasskeys).values({
      userId: user.id,
      label: name,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: (credential.transports ?? []).join(","),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    });
    await writeAudit(
      { userId: user.id, action: "mfa.passkey_added", entity: "user", entityId: user.id, detail: { label: name } },
      tx,
    );
    const recoveryCodes = hadFactor ? null : await issueRecoveryCodes(user.id, tx);
    return { recoveryCodes };
  });
}

export async function renamePasskey(user: { id: string }, passkeyId: string, label: string): Promise<void> {
  const name = label.trim().slice(0, 100);
  if (!name) return;
  await db
    .update(mfaPasskeys)
    .set({ label: name })
    .where(and(eq(mfaPasskeys.id, passkeyId), eq(mfaPasskeys.userId, user.id)));
}

export async function removePasskey(user: { id: string }, passkeyId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(mfaPasskeys)
      .where(and(eq(mfaPasskeys.id, passkeyId), eq(mfaPasskeys.userId, user.id)))
      .returning({ label: mfaPasskeys.label });
    if (!row) throw new NotFoundError("Passkey");
    await writeAudit(
      { userId: user.id, action: "mfa.passkey_removed", entity: "user", entityId: user.id, detail: { label: row.label } },
      tx,
    );
  });
}

export async function beginPasskeyAuthentication(
  userId: string,
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const existing = await userPasskeys(userId);
  if (existing.length === 0) return null;
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: existing.map((row) => ({ id: row.credentialId, transports: transportsOf(row.transports) })),
    userVerification: "preferred",
  });
  await keep(`passkey-verify:${userId}`, options.challenge);
  return options;
}

/* ---------- The second step ---------- */

export class SecondStepLockedError extends Error {
  constructor(readonly until: Date) {
    super("Too many wrong answers. Try again later.");
    this.name = "SecondStepLockedError";
  }
}

/* Attempts per person in the last minute, held in this process. */
const recent = new Map<string, number[]>();

function throttle(userId: string): void {
  const now = Date.now();
  const stamps = (recent.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (stamps.length >= ATTEMPTS_PER_MINUTE) throw new SecondStepLockedError(new Date(now + 60_000));
  stamps.push(now);
  recent.set(userId, stamps);
  if (recent.size > 10_000) {
    for (const [key, list] of recent) if (list.every((at) => now - at >= 60_000)) recent.delete(key);
  }
}

async function guard(userId: string): Promise<void> {
  const [row] = await db
    .select({ until: users.mfaLockedUntil })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (row?.until && row.until.getTime() > Date.now()) throw new SecondStepLockedError(row.until);
  throttle(userId);
}

/** A wrong answer: counted, logged, and the tenth in a row closes the second step for a while. */
async function failed(userId: string, method: string, address: string | null): Promise<never> {
  const [row] = await db
    .update(users)
    .set({ mfaFailures: sql`${users.mfaFailures} + 1` })
    .where(eq(users.id, userId))
    .returning({ failures: users.mfaFailures });
  const failures = row?.failures ?? 0;
  const locked = failures >= MFA_LOCK_AFTER;
  if (locked) {
    await db
      .update(users)
      .set({ mfaFailures: 0, mfaLockedUntil: new Date(Date.now() + MFA_LOCK_MINUTES * 60_000) })
      .where(eq(users.id, userId));
  }
  await writeAudit({
    userId,
    action: locked ? "mfa.locked" : "mfa.failed",
    entity: "user",
    entityId: userId,
    detail: { method, address, failures },
  });
  if (locked) throw new SecondStepLockedError(new Date(Date.now() + MFA_LOCK_MINUTES * 60_000));
  throw new WrongCodeError();
}

async function passed(userId: string, sessionToken: string, method: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaFailures: 0, mfaLockedUntil: null }).where(eq(users.id, userId));
    await tx
      .update(sessions)
      .set({ mfaVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(sessions.token, sessionToken));
    await writeAudit({ userId, action: "mfa.verified", entity: "user", entityId: userId, detail: { method } }, tx);
  });
}

export async function verifyTotpStep(
  userId: string,
  code: string,
  sessionToken: string,
  address: string | null,
): Promise<void> {
  await guard(userId);
  const [row] = await db
    .select({ secret: mfaTotp.secretEncrypted, lastStep: mfaTotp.lastUsedStep })
    .from(mfaTotp)
    .where(eq(mfaTotp.userId, userId))
    .limit(1);
  const secret = row ? open(row.secret, env.AUTH_SECRET, TOTP_PURPOSE) : null;
  if (!secret) return failed(userId, "totp", address);

  const result = verifyTotp(secret, code, { afterStep: row?.lastStep ?? null });
  if (!result.ok) return failed(userId, "totp", address);

  await db
    .update(mfaTotp)
    .set({ lastUsedStep: result.step, lastUsedAt: new Date() })
    .where(eq(mfaTotp.userId, userId));
  await passed(userId, sessionToken, "totp");
}

export async function verifyRecoveryCodeStep(
  userId: string,
  code: string,
  sessionToken: string,
  address: string | null,
): Promise<{ left: number }> {
  await guard(userId);
  const [row] = await db
    .update(mfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(mfaRecoveryCodes.userId, userId),
        eq(mfaRecoveryCodes.codeHash, hashRecoveryCode(code)),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCodes.id });
  if (!row) return failed(userId, "recovery", address);

  await passed(userId, sessionToken, "recovery");
  const [left] = await db
    .select({ left: sql<number>`count(*)::int` })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
  return { left: left?.left ?? 0 };
}

export async function verifyPasskeyStep(
  userId: string,
  response: AuthenticationResponseJSON,
  sessionToken: string,
  address: string | null,
): Promise<void> {
  await guard(userId);
  const challenge = await take(`passkey-verify:${userId}`);
  if (!challenge) throw new NothingPendingError();

  const passkeys = await userPasskeys(userId);
  const stored = passkeys.find((row) => row.credentialId === response.id);
  if (!stored) return failed(userId, "passkey", address);

  const { rpID, origin } = relyingParty();
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
        counter: stored.counter,
        transports: transportsOf(stored.transports),
      },
    });
  } catch {
    return failed(userId, "passkey", address);
  }
  if (!verified.verified) return failed(userId, "passkey", address);

  await db
    .update(mfaPasskeys)
    .set({ counter: verified.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(mfaPasskeys.id, stored.id));
  await passed(userId, sessionToken, "passkey");
}

/* ---------- Administration ---------- */

/**
 * Everything a person enrolled, gone, so they can start again: for a lost
 * phone and a lost key together. Their sessions are no longer verified and
 * their grace period starts afresh. Done from the interface and logged, or by
 * a sole administrator from the server console (scripts/reset-mfa.ts), never
 * by hand in the database.
 */
export async function resetMfa(userId: string, actorId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const cleared = await clearSecondStep(tx, userId);
    if (!cleared) throw new NotFoundError("User");
    await writeAudit(
      { userId: actorId, action: "mfa.reset", entity: "user", entityId: userId, detail: { email: cleared.email } },
      tx,
    );
  });
}

/** What the users page shows beside each person. */
export type MfaSummary = {
  userId: string;
  totp: boolean;
  passkeys: number;
  /** When an administrator must have enrolled by, and whether that has passed. */
  deadline: Date | null;
  overdue: boolean;
  /** The later of the two locks still in force, or null. */
  lockedUntil: Date | null;
};

export async function mfaSummaries(userIds: string[]): Promise<Map<string, MfaSummary>> {
  if (userIds.length === 0) return new Map();
  const now = Date.now();
  const rows = await db
    .select({
      userId: users.id,
      deadline: users.mfaDeadline,
      lockedUntil: users.lockedUntil,
      mfaLockedUntil: users.mfaLockedUntil,
      totp: sql<boolean>`exists(select 1 from ${mfaTotp} where ${mfaTotp.userId} = ${users.id})`,
      passkeys: sql<number>`(select count(*) from ${mfaPasskeys} where ${mfaPasskeys.userId} = ${users.id})::int`,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(
    rows.map((row) => {
      const locks = [row.lockedUntil, row.mfaLockedUntil]
        .filter((at): at is Date => !!at && at.getTime() > now)
        .sort((a, b) => b.getTime() - a.getTime());
      return [
        row.userId,
        {
          userId: row.userId,
          totp: row.totp,
          passkeys: row.passkeys,
          deadline: row.deadline,
          overdue: !!row.deadline && row.deadline.getTime() <= now,
          lockedUntil: locks[0] ?? null,
        },
      ];
    }),
  );
}
