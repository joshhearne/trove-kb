import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins";
import { db } from "@/server/db";
import { users, sessions, accounts, verifications } from "@/server/db/schema";
import { env } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/server/services/password";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/server/auth/password-policy";
import {
  clearSignInFailures,
  isSignInLocked,
  recordSignInFailure,
} from "@/server/services/accounts";
import { mailConfigured, sendMail } from "@/server/mail";

/** The one answer to a wrong address, a wrong password, and a closed account. */
export const SIGN_IN_FAILED = "Incorrect email or password";

const SIGN_IN_PATH = "/sign-in/email";

function addressOf(headers: Headers | undefined): string | null {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip") || null;
}

/** The provider id the sign-in page posts to. */
export const OIDC_PROVIDER_ID = "oidc";

export const oidcConfigured = Boolean(
  env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET,
);

export const auth = betterAuth({
  appName: "Trove KB",
  baseURL: env.APP_URL,
  secret: env.AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema: { users, sessions, accounts, verifications },
  }),

  /**
   * An account made ahead of a person's first visit has no password; when
   * they arrive through single sign-on with the same email, that is them.
   */
  account: {
    accountLinking: { enabled: true, trustedProviders: oidcConfigured ? [OIDC_PROVIDER_ID] : [] },
  },

  emailAndPassword: {
    enabled: true,
    // Accounts are created by the first-run setup screen and (later) by admins,
    // never by an open sign-up endpoint.
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
    // A forgotten password is a link in the mail, good for an hour, when mail
    // is set up. The reset page itself judges the new password by the policy.
    ...(mailConfigured
      ? {
          sendResetPassword: async ({ user, url }) => {
            await sendMail({
              to: user.email,
              subject: "Reset your Trove KB password",
              text:
                `Somebody asked to reset the password for ${user.email}.\n\n` +
                `Open this link within an hour to choose a new one:\n${url}\n\n` +
                "If that was not you, ignore this message. Your password has not changed.",
            });
          },
          resetPasswordTokenExpiresIn: 60 * 60,
          revokeSessionsOnPasswordReset: true,
        }
      : {}),
  },

  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "tech", input: false },
      canRevealSecrets: { type: "boolean", defaultValue: false, input: false },
      mustChangePassword: { type: "boolean", defaultValue: false, input: false },
      secretStyle: { type: "string", defaultValue: "on", input: false },
      editorView: { type: "string", defaultValue: "visual", input: false },
    },
  },

  session: {
    additionalFields: {
      /** When the session passed the second step; null until it has. */
      mfaVerifiedAt: { type: "date", required: false, input: false },
    },
  },

  /*
   * Guessing. Ten wrong passwords in a row close the account for a while, and
   * a closed account answers exactly as a wrong password does, so the closing
   * tells a guesser nothing. Every failure is in the audit log.
   */
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH) return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
      if (email && (await isSignInLocked(email))) {
        throw new APIError("UNAUTHORIZED", { message: SIGN_IN_FAILED });
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== SIGN_IN_PATH) return;
      const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
      if (!email) return;
      const returned = ctx.context.returned;
      if (returned instanceof APIError) {
        await recordSignInFailure(email, addressOf(ctx.headers));
      } else if (returned && typeof returned === "object" && "user" in returned) {
        const user = (returned as { user: { id: string } }).user;
        await clearSignInFailures(user.id);
      }
    }),
  },

  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: env.APP_URL.startsWith("https://"),
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },

  /**
   * OIDC is optional: configure OIDC_ISSUER, OIDC_CLIENT_ID, and
   * OIDC_CLIENT_SECRET and a "Sign in with SSO" button appears. Works with
   * Entra ID, Google, Authentik, and Keycloak through discovery.
   */
  plugins: [
    ...(oidcConfigured
      ? [
          genericOAuth({
            config: [
              {
                providerId: OIDC_PROVIDER_ID,
                clientId: env.OIDC_CLIENT_ID as string,
                clientSecret: env.OIDC_CLIENT_SECRET as string,
                discoveryUrl: `${(env.OIDC_ISSUER as string).replace(/\/$/, "")}/.well-known/openid-configuration`,
                scopes: ["openid", "profile", "email"],
              },
            ],
          }),
        ]
      : []),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
