import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import type { Pool } from "pg";
import {
  canUsePublicSession,
  isRestrictedPublicEmail,
} from "./active-account.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./contracts.js";
import {
  credentialLoginProof,
  readCredentialProof,
} from "./credential-login.js";
import { type AuthMailer, isDeliverableEmail } from "./email.js";
import { createPublicBeforeHook } from "./public-before-hook.js";
import { registrationContext } from "./registration-context.js";
import {
  createTelegramBotLoginPlugin,
  telegramBotLoginContext,
} from "./telegram-bot-login.js";

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
        emailLoginRevision: {
          type: "number",
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
        telegramBotRequestId: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        telegramBotBrowserHash: {
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
        resetRevision: {
          type: "number",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          async before(user, context) {
            if (context?.path !== "/sign-up/email") return;
            const proof = registrationContext.getStore();
            if (!proof || proof.email !== user.email)
              throw new APIError("BAD_REQUEST", {
                code: "AUTH_REQUEST_FAILED",
              });
            return {
              data: {
                emailVerified: true,
                username: proof.registration.username,
              },
            };
          },
        },
      },
      verification: {
        create: {
          async before(verification, context) {
            if (!verification.identifier.startsWith("reset-password:")) return;
            const proof = readCredentialProof(context?.context);
            if (
              context?.path !== "/request-password-reset" ||
              !proof ||
              proof.userId !== verification.value ||
              (await isRestrictedPublicEmail(database, proof.email))
            )
              throw new APIError("BAD_REQUEST", {
                code: "AUTH_REQUEST_FAILED",
              });
            return {
              data: { resetEmail: proof.email, resetRevision: proof.revision },
            };
          },
        },
      },
      account: {
        create: {
          async before(account, context) {
            if (
              context?.path === "/sign-up/email" &&
              account.providerId === "credential"
            ) {
              const proof = registrationContext.getStore();
              if (!proof)
                throw new APIError("BAD_REQUEST", {
                  code: "AUTH_REQUEST_FAILED",
                });
              return {
                data: {
                  registrationProofHash: proof.proofHash,
                  registrationProfile: JSON.stringify(
                    proof.registration.profile,
                  ),
                },
              };
            }
            // Public recovery may replace only an existing credential.
            if (
              context?.path === "/reset-password" &&
              account.providerId === "credential"
            )
              throw new APIError("BAD_REQUEST", {
                code: "AUTH_REQUEST_FAILED",
              });
            if (account.providerId !== "credential") return false;
          },
        },
        update: {
          async before(account, context) {
            if (typeof account.password !== "string") return;
            const proof = readCredentialProof(context?.context);
            if (
              !proof ||
              (context?.path !== "/change-password" &&
                context?.path !== "/reset-password")
            )
              throw new APIError("BAD_REQUEST", {
                code: "AUTH_REQUEST_FAILED",
              });
            return {
              data: {
                rotationUserId: proof.userId,
                rotationEmail: proof.email,
                rotationRevision: proof.revision,
              },
            };
          },
        },
      },
      session: {
        create: {
          async before(session, context) {
            const bot = telegramBotLoginContext.getStore();
            if (bot) {
              if (
                context?.path !== "/telegram-bot/finish-login" ||
                bot.userId !== session.userId ||
                !(await canUsePublicSession(database, session.userId, true))
              )
                return false;
              return {
                data: {
                  telegramAccountId: bot.telegramAccountId,
                  telegramBotRequestId: bot.telegramBotRequestId,
                  telegramBotBrowserHash: bot.telegramBotBrowserHash,
                },
              };
            }
            if (!(await canUsePublicSession(database, session.userId, false)))
              return false;
            if (context?.path !== "/sign-in/email") return true;
            const proof = credentialLoginProof(context.context, session.userId);
            return proof ? { data: proof } : false;
          },
        },
      },
    },
    hooks: { before: createPublicBeforeHook(database) },
    account: {
      additionalFields: {
        registrationProofHash: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        registrationProfile: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        rotationUserId: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        rotationEmail: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
        rotationRevision: {
          type: "number",
          required: false,
          input: false,
          returned: false,
        },
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
        enabled: false,
        updateUserInfoOnLink: false,
        allowUnlinkingAll: false,
      },
    },
    ...(telegramEnabled(config)
      ? {
          plugins: [
            createTelegramBotLoginPlugin(database, config.AUTH_WEB_ORIGIN),
          ],
        }
      : {}),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: RESET_PASSWORD_TTL_SECONDS,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        if (!isDeliverableEmail(user.email)) return;
        await mailer.send("reset-password", user.email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
    },
    user: {
      deleteUser: { enabled: false },
      additionalFields: {
        username: {
          type: "string",
          required: false,
          input: false,
          returned: false,
        },
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
