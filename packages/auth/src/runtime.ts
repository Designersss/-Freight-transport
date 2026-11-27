import { PrivateStorage, type StorageConfig } from "@freight/storage";
import { Pool } from "pg";
import { eligibleAccount, isRestrictedPublicEmail } from "./active-account.js";
import { createAdminAuth, handleAdminAuth } from "./admin-auth.js";
import { AUTH_BASE_PATH, createEmailAuth } from "./auth.js";
import { cabinetRole, handleCabinet } from "./cabinet-http.js";
import { type AuthConfig, parseAuthConfig, telegramEnabled } from "./config.js";
import {
  authBodies as bodies,
  publicSession,
  registrationInput,
} from "./contracts.js";
import { handleDeactivation } from "./deactivation-http.js";
import { handleEmailChange } from "./email-change-http.js";
import { reserveMailRequest } from "./mail-rate-limit.js";
import { handleProfile, handleProfileSettings } from "./profile.js";
import { handleProfilePhoto } from "./profile-photo.js";
import { completeRegistration, usernameOwner } from "./registration.js";
import { handleSessionSettings } from "./session-settings.js";
import { createSmtpMailer } from "./smtp-mailer.js";
import { handleTelegramOAuth } from "./telegram-oauth-http.js";
import { handleTelegramRegistration } from "./telegram-registration-http.js";
import { handleTelegramSettings } from "./telegram-settings-http.js";
import { handleUsername } from "./username.js";
import { handleUsernameSettings } from "./username-settings.js";
import {
  internalSession,
  readVerifiedSession,
  sessionAccess,
  toPublicSession,
} from "./verified-session.js";

export {
  MAX_PROFILE_PHOTO_BYTES,
  parseStorageConfig,
  type StorageConfig,
} from "@freight/storage";
export { type AuthConfig, parseAuthConfig } from "./config.js";

export interface AuthHttpRuntime {
  handle(request: Request): Promise<Response>;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
}

function failure(status: number, code: string): Response {
  return Response.json(
    { code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export function createAuthHttpRuntime(
  config: AuthConfig,
  databaseUrl: string,
  storageConfig?: StorageConfig,
): AuthHttpRuntime {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  const mailer = createSmtpMailer(config);
  const auth = createEmailAuth(config, pool, mailer);
  const admin = createAdminAuth(config, pool);
  const storage = storageConfig ? new PrivateStorage(storageConfig) : null;
  const destination = (language: string, page: string) =>
    new URL(`/${language}${page}`, config.AUTH_WEB_ORIGIN).href;
  const destinations = (page: string) =>
    ["ru", "en"].map((language) => destination(language, page));

  return {
    async handle(request) {
      const url = new URL(request.url);
      if (
        url.origin !== config.AUTH_BASE_URL ||
        !url.pathname.startsWith(`${AUTH_BASE_PATH}/`)
      ) {
        return failure(404, "NOT_FOUND");
      }
      const path = url.pathname.slice(AUTH_BASE_PATH.length);
      if (path.startsWith("/admin/"))
        return admin
          ? handleAdminAuth(request, config, admin, pool)
          : failure(404, "NOT_FOUND");
      if (path === "/account/deactivate")
        return handleDeactivation(request, config, auth, pool);
      const requiredRole = cabinetRole(path);
      if (requiredRole)
        return handleCabinet(request, config, auth, pool, requiredRole);
      if (path === "/email/change" || path === "/email/change/confirm")
        return handleEmailChange(request, config, auth, pool, mailer);
      if (path === "/telegram/status") {
        if (request.method !== "GET") return failure(405, "METHOD_NOT_ALLOWED");
        if (url.search) return failure(400, "INVALID_REQUEST");
        return Response.json(
          { enabled: telegramEnabled(config) },
          { headers: { "cache-control": "no-store" } },
        );
      }
      if (path === "/telegram/start" || path === "/telegram/callback")
        return handleTelegramOAuth(request, config, auth, pool);
      if (path === "/telegram/settings")
        return handleTelegramSettings(request, config, auth, pool);
      if (path === "/telegram/registration")
        return handleTelegramRegistration(request, config, auth, pool);
      if (path === "/sessions")
        return handleSessionSettings(request, config, auth, pool);
      if (path === "/profile/photo") {
        return storage
          ? handleProfilePhoto(request, config, auth, pool, storage)
          : failure(503, "AUTH_REQUEST_FAILED");
      }
      if (path === "/profile/settings")
        return handleProfileSettings(request, config, auth, pool);
      if (path === "/profile")
        return handleProfile(request, config, auth, pool);
      if (path === "/username") return handleUsername(request, config, pool);
      if (path === "/username/settings")
        return handleUsernameSettings(request, config, auth, pool);
      const headers = new Headers(request.headers);
      let body: string | undefined;
      let username: string | undefined;
      if (request.method === "POST") {
        if (!Object.hasOwn(bodies, path)) return failure(404, "NOT_FOUND");
        if (headers.get("origin") !== config.AUTH_WEB_ORIGIN)
          return failure(403, "INVALID_ORIGIN");
        if (
          url.search ||
          !headers.get("content-type")?.startsWith("application/json")
        )
          return failure(400, "INVALID_REQUEST");
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return failure(400, "INVALID_REQUEST");
        }
        const parsed = bodies[path as keyof typeof bodies].safeParse(raw);
        if (!parsed.success) return failure(400, "INVALID_REQUEST");
        const { locale: language, ...fields } = {
          locale: "ru",
          ...parsed.data,
        };
        const payload: Record<string, unknown> = fields;
        if (path === "/sign-up/email") {
          const registration = registrationInput.parse(payload.registration);
          delete payload.registration;
          username = registration.username;
          payload.username = username;
          payload.registrationDraft = JSON.stringify(registration.profile);
          payload.name = `${registration.profile.firstName} ${registration.profile.lastName}`;
        }
        if (path === "/sign-up/email" || path === "/send-verification-email") {
          payload.callbackURL = destination(language, "/email-confirmation");
        }
        if (path === "/change-password") payload.revokeOtherSessions = true;
        if (path === "/request-password-reset") {
          payload.redirectTo = destination(language, "/reset-password");
        }
        if (
          typeof payload.email === "string" &&
          [
            "/sign-up/email",
            "/send-verification-email",
            "/request-password-reset",
          ].includes(path)
        ) {
          try {
            const retry = await reserveMailRequest(
              pool,
              config.AUTH_SECRET,
              path === "/request-password-reset"
                ? "password-reset"
                : "verification",
              payload.email,
            );
            if (retry !== null)
              return Response.json(
                { code: "RATE_LIMITED" },
                {
                  status: 429,
                  headers: {
                    "cache-control": "no-store",
                    "retry-after": String(retry),
                  },
                },
              );
          } catch {
            return failure(503, "AUTH_REQUEST_FAILED");
          }
        }
        if (
          path === "/request-password-reset" &&
          typeof payload.email === "string"
        ) {
          try {
            if (await isRestrictedPublicEmail(pool, payload.email))
              return Response.json(
                { success: true },
                { headers: { "cache-control": "no-store" } },
              );
          } catch {
            return failure(503, "AUTH_REQUEST_FAILED");
          }
        }
        body = JSON.stringify(payload);
        headers.delete("content-length");
      } else if (request.method === "GET") {
        if (path === "/get-session") {
          if (url.search) return failure(400, "INVALID_REQUEST");
        } else if (
          path === "/verify-email" ||
          /^\/reset-password\/[^/]+$/.test(path)
        ) {
          const callback = url.searchParams.get("callbackURL");
          const allowed = destinations(
            path === "/verify-email"
              ? "/email-confirmation"
              : "/reset-password",
          );
          const keys = [...url.searchParams.keys()];
          if (
            !callback ||
            !allowed.includes(callback) ||
            keys.some(
              (key) =>
                ![
                  "callbackURL",
                  ...(path === "/verify-email" ? ["token"] : []),
                ].includes(key),
            ) ||
            new Set(keys).size !== keys.length ||
            (path === "/verify-email" && !url.searchParams.get("token"))
          )
            return failure(400, "INVALID_REQUEST");
        } else return failure(404, "NOT_FOUND");
      } else return failure(405, "METHOD_NOT_ALLOWED");

      try {
        if (path === "/change-password") {
          const session = await readVerifiedSession(
            request,
            config,
            auth,
            new Headers({ "cache-control": "no-store" }),
            pool,
          );
          if (session instanceof Response) return session;
          if (session.access !== "email")
            return failure(403, "AUTH_REQUEST_FAILED");
          const eligible = await pool.query(`SELECT u.id ${eligibleAccount}`, [
            session.user.id,
            session.session.id,
          ]);
          if (!eligible.rowCount) return failure(403, "AUTH_REQUEST_FAILED");
        }
        if (username && (await usernameOwner(pool, username)))
          return failure(409, "USERNAME_TAKEN");
        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers,
            ...(body === undefined ? {} : { body }),
          }),
        );
        const outputHeaders = new Headers({
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        });
        for (const cookie of response.headers.getSetCookie())
          outputHeaders.append("set-cookie", cookie);
        const retryAfter =
          response.headers.get("retry-after") ??
          response.headers.get("x-retry-after");
        if (retryAfter) outputHeaders.set("retry-after", retryAfter);
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          const target = new URL(location, config.AUTH_BASE_URL);
          if (target.origin !== config.AUTH_WEB_ORIGIN)
            return failure(400, "INVALID_REDIRECT");
          if (
            path === "/verify-email" &&
            !target.searchParams.has("error") &&
            destinations("/email-confirmation").includes(target.href)
          ) {
            target.pathname = target.pathname.replace(
              /\/email-confirmation$/,
              "/login",
            );
            target.searchParams.set("verified", "done");
          }
          outputHeaders.set("location", target.href);
          return new Response(null, {
            status: response.status,
            headers: outputHeaders,
          });
        }
        if (!response.ok) {
          if (
            username &&
            response.status === 422 &&
            (await usernameOwner(pool, username))
          )
            return failure(409, "USERNAME_TAKEN");
          let code =
            response.status === 429 ? "RATE_LIMITED" : "AUTH_REQUEST_FAILED";
          if (path === "/sign-in/email" && response.status === 403) {
            const error: unknown = await response.json().catch(() => null);
            if (
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "EMAIL_NOT_VERIFIED"
            )
              code = "EMAIL_NOT_VERIFIED";
          }
          if (path === "/change-password" && response.status === 400) {
            const error: unknown = await response.json().catch(() => null);
            if (
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "INVALID_PASSWORD"
            )
              code = "INVALID_CURRENT_PASSWORD";
          }
          if (path === "/sign-in/email" && response.status === 401)
            code = "INVALID_CREDENTIALS";
          return Response.json(
            {
              code,
            },
            { status: response.status, headers: outputHeaders },
          );
        }
        if (path === "/get-session") {
          const result = await response.json();
          if (result === null)
            return Response.json(null, { headers: outputHeaders });
          const session = internalSession.parse(result);
          const access = await sessionAccess(pool, config, session);
          if (access === "denied") return failure(403, "AUTH_REQUEST_FAILED");
          return Response.json(toPublicSession(session, access), {
            headers: outputHeaders,
          });
        }
        if (username) {
          const result: unknown = await response.json();
          const owner = await usernameOwner(pool, username);
          if (
            owner &&
            (!result ||
              typeof result !== "object" ||
              !("user" in result) ||
              publicSession.shape.user.parse(result.user).id !== owner)
          )
            return failure(409, "USERNAME_TAKEN");
        }
        if (path === "/sign-in/email")
          await completeRegistration(pool, await response.json());
        // Never expose Better Auth's raw session token or synthetic signup user.
        return Response.json({ success: true }, { headers: outputHeaders });
      } catch {
        return failure(500, "AUTH_REQUEST_FAILED");
      }
    },
    async checkReadiness() {
      if (storage) await storage.checkReadiness();
    },
    async close() {
      try {
        storage?.close();
      } finally {
        await pool.end();
      }
    },
  };
}

export function parseRuntimeAuthConfig(
  env: Record<string, unknown>,
): AuthConfig | undefined {
  if (env.AUTH_ENABLED === undefined || env.AUTH_ENABLED === "false")
    return undefined;
  if (env.AUTH_ENABLED !== "true") throw new Error("Invalid AUTH_ENABLED");
  const config = parseAuthConfig(env);
  if (config.NODE_ENV === "production")
    throw new Error(
      "Auth production activation requires RD-04 security acceptance",
    );
  return config;
}
