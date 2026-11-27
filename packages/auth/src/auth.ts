import { type BetterAuthOptions, betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import type { Pool } from "pg";
import { canUsePublicSession } from "./active-account.js";
import { isPlatformAdminEmail } from "./admin-principal.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./contracts.js";
import { type AuthMailer, isDeliverableEmail } from "./email.js";
import {
  findTelegramLoginAccount,
  prepareTelegramLink,
  telegramLinkContext,
  telegramLinkProof,
  telegramLoginContext,
  validateTelegramLink,
} from "./telegram-link-context.js";
import { createTelegramProvider } from "./telegram-provider.js";

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
      useSecureCookies:
        config.AUTH_BASE_URL.startsWith("https://") ||
        config.AUTH_WEB_ORIGIN.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["x-movaro-client-ip"] },
    },
    rateLimit: { enabled: true, storage: "database" },
    session: {
      cookieCache: { enabled: false },
      additionalFields: {
        emailLoginProof: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        telegramAccountId: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    verification: {
      additionalFields: {
        resetEmail: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    databaseHooks: {
      verification: {
        create: {
          async before(verification, context) {
            if (!verification.identifier.startsWith("reset-password:")) return;
            const email = context?.body?.email;
            if (
              context?.path !== "/request-password-reset" ||
              typeof email !== "string" ||
              !isDeliverableEmail(email)
            )
              return false;
            if (await isPlatformAdminEmail(database, email)) return false;
            return { data: { resetEmail: email.toLowerCase() } };
          },
        },
      },
      account: {
        create: {
          async before(account) {
            if (account.providerId !== "telegram") return;
            if (!telegramLinkContext.getStore()) return;
            const proof = await telegramLinkProof(account.userId);
            return proof ? { data: proof } : false;
          },
        },
      },
      session: {
        create: {
          async before(session, context) {
            if (
              !(await canUsePublicSession(
                database,
                session.userId,
                telegramEnabled(config),
              ))
            )
              return false;
            const login = telegramLoginContext.getStore();
            if (!login) {
              if (context?.path !== "/sign-in/email") return true;
              const email = context.body?.email;
              return typeof email === "string" && isDeliverableEmail(email)
                ? { data: { emailLoginProof: email.toLowerCase() } }
                : false;
            }
            if (!login.providerEmail) return false;
            const telegramAccountId = await findTelegramLoginAccount(
              database,
              session.userId,
              login.providerEmail,
            );
            return telegramAccountId ? { data: { telegramAccountId } } : false;
          },
        },
      },
    },
    hooks: { before: prepareTelegramLink },
    account: {
      additionalFields: {
        linkSessionId: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        linkRevision: {
          type: "number",
          required: false,
          input: false,
          returned: false,
        },
      },
      accountLinking: {
        disableImplicitLinking: true,
        trustedProviders: telegramEnabled(config) ? ["telegram"] : [],
        allowDifferentEmails: telegramEnabled(config),
        updateUserInfoOnLink: false,
        allowUnlinkingAll: false,
      },
    },
    ...(config.AUTH_TELEGRAM_CLIENT_ID && config.AUTH_TELEGRAM_CLIENT_SECRET
      ? {
          plugins: [
            genericOAuth({
              config: [
                {
                  ...createTelegramProvider(
                    config.AUTH_TELEGRAM_CLIENT_ID,
                    config.AUTH_TELEGRAM_CLIENT_SECRET,
                  ),
                  redirectURI: new URL(
                    "/api/auth/telegram/callback",
                    config.AUTH_WEB_ORIGIN,
                  ).href,
                  responseMode: "query",
                },
              ],
            }),
          ],
        }
      : {}),
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
      async validateUserInfo({ user, source }) {
        if (source.action === "link-account") {
          if (
            source.method !== "oauth" ||
            source.oauth?.providerId !== "telegram" ||
            !telegramEnabled(config) ||
            !(await validateTelegramLink(database, user.id))
          )
            return { error: "AUTH_REQUEST_FAILED" };
        } else if (
          source.method === "oauth" &&
          source.oauth?.providerId === "telegram"
        ) {
          const login = telegramLoginContext.getStore();
          if (
            telegramLinkContext.getStore() ||
            !login ||
            typeof user.email !== "string" ||
            !/^[0-9a-f]{64}@telegram\.invalid$/.test(user.email)
          )
            return { error: "AUTH_REQUEST_FAILED" };
          login.providerEmail = user.email;
        }
      },
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
