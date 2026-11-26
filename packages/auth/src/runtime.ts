import { Pool } from "pg";
import { z } from "zod";
import { AUTH_BASE_PATH, createEmailAuth } from "./auth.js";
import { type AuthConfig, parseAuthConfig } from "./config.js";
import { isDeliverableEmail } from "./email.js";
import { createSmtpMailer } from "./smtp-mailer.js";

export { type AuthConfig, parseAuthConfig } from "./config.js";

const email = z
  .email()
  .transform((value) => value.toLowerCase())
  .refine(isDeliverableEmail);
const password = z.string().min(12).max(128);
const locale = z.enum(["ru", "en"]).default("ru");
const bodies = {
  "/sign-up/email": z.strictObject({
    email,
    password,
    name: z.string().trim().min(1).max(200),
    locale,
  }),
  "/sign-in/email": z.strictObject({
    email,
    password: z.string().min(1).max(128),
  }),
  "/sign-out": z.strictObject({}),
  "/send-verification-email": z.strictObject({ email, locale }),
  "/request-password-reset": z.strictObject({ email, locale }),
  "/reset-password": z.strictObject({
    token: z.string().min(1).max(512),
    newPassword: password,
  }),
};

const publicSession = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
  }),
  session: z.object({ expiresAt: z.string() }),
});

export interface AuthHttpRuntime {
  handle(request: Request): Promise<Response>;
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
): AuthHttpRuntime {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  const auth = createEmailAuth(config, pool, createSmtpMailer(config));
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
      const headers = new Headers(request.headers);
      let body: string | undefined;
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
        if (path === "/sign-up/email" || path === "/send-verification-email") {
          payload.callbackURL = destination(language, "/");
        }
        if (path === "/request-password-reset") {
          payload.redirectTo = destination(language, "/reset-password");
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
            path === "/verify-email" ? "/" : "/reset-password",
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
          outputHeaders.set("location", target.href);
          return new Response(null, {
            status: response.status,
            headers: outputHeaders,
          });
        }
        if (!response.ok)
          return Response.json(
            {
              code:
                response.status === 429
                  ? "RATE_LIMITED"
                  : "AUTH_REQUEST_FAILED",
            },
            { status: response.status, headers: outputHeaders },
          );
        if (path === "/get-session") {
          const result = await response.json();
          if (result === null)
            return Response.json(null, { headers: outputHeaders });
          const session = publicSession.parse(result);
          if (!isDeliverableEmail(session.user.email))
            return failure(403, "AUTH_REQUEST_FAILED");
          return Response.json(session, { headers: outputHeaders });
        }
        // Never expose Better Auth's raw session token or synthetic signup user.
        return Response.json({ success: true }, { headers: outputHeaders });
      } catch {
        return failure(500, "AUTH_REQUEST_FAILED");
      }
    },
    async close() {
      await pool.end();
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
