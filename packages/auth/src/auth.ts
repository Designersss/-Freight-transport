import { type BetterAuthOptions, betterAuth } from "better-auth";
import type { Pool } from "pg";
import { canUsePublicSession } from "./active-account.js";
import type { AuthConfig } from "./config.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./contracts.js";
import { type AuthMailer, isDeliverableEmail } from "./email.js";

export const AUTH_BASE_PATH = "/api/v1/auth";
export const RESET_PASSWORD_TTL_SECONDS = 15 * 60;

// Only the HTTP adapter will expose an explicit set of routes; this factory
// is not itself a public HTTP handler or an authorization guard.
export function createAuthOptions(
  config: AuthConfig,
  database: Pool,
  mailer: AuthMailer,
): BetterAuthOptions {
  return {
    baseURL: config.AUTH_BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret: config.AUTH_SECRET,
    database,
    trustedOrigins: [config.AUTH_WEB_ORIGIN],
    telemetry: { enabled: false },
    logger: { disabled: true },
    advanced: {
      useSecureCookies: config.AUTH_BASE_URL.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["x-movaro-client-ip"] },
    },
    rateLimit: { enabled: true, storage: "database" },
    session: { cookieCache: { enabled: false } },
    databaseHooks: {
      session: {
        create: {
          async before(session) {
            return canUsePublicSession(database, session.userId);
          },
        },
      },
    },
    account: { accountLinking: { disableImplicitLinking: true } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        if (!isDeliverableEmail(user.email)) return;
        await mailer.send("reset-password", user.email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      async sendVerificationEmail({ user, url }) {
        if (!isDeliverableEmail(user.email)) return;
        await mailer.send("verify-email", user.email, url);
      },
    },
    user: {
      deleteUser: { enabled: false },
      additionalFields: {
        username: { type: "string", required: false, returned: false },
        registrationDraft: { type: "string", required: false, returned: false },
      },
    },
  };
}

export interface EmailAuth {
  handler(request: Request): Promise<Response>;
}

export function createEmailAuth(
  config: AuthConfig,
  database: Pool,
  mailer: AuthMailer,
): EmailAuth {
  return betterAuth(createAuthOptions(config, database, mailer));
}
