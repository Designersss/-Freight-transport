import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import type { Pool } from "pg";
import { z } from "zod";
import { canUseAdminSession, readAdminPrincipal } from "./admin-principal.js";
import type { EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import { adminLoginInput, adminSession } from "./contracts.js";
import { credentialLoginProof, prepareCredentialLogin } from "./credential-login.js";
import { internalSession } from "./verified-session.js";

const basePath = "/api/v1/auth/admin";

export function createAdminAuth(
  config: AuthConfig,
  pool: Pool,
): EmailAuth | null {
  if (!config.AUTH_ADMIN_ORIGIN || !config.AUTH_ADMIN_SECRET) return null;
  return betterAuth({
    baseURL: config.AUTH_BASE_URL,
    basePath,
    secret: config.AUTH_ADMIN_SECRET,
    database: pool,
    trustedOrigins: [config.AUTH_ADMIN_ORIGIN],
    telemetry: { enabled: false },
    logger: { disabled: true },
    advanced: {
      cookiePrefix: "movaro-admin",
      useSecureCookies:
        config.AUTH_BASE_URL.startsWith("https://") ||
        config.AUTH_ADMIN_ORIGIN.startsWith("https://"),
      ipAddress: { ipAddressHeaders: ["x-movaro-client-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    session: {
      expiresIn: 8 * 60 * 60,
      disableSessionRefresh: true,
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
        adminSession: {
          type: "boolean",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 16,
      maxPasswordLength: 128,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email")
          return prepareCredentialLogin(pool, ctx.body?.email);
      }),
    },
    databaseHooks: {
      session: {
        create: {
          async before(session, context) {
            if (context?.path !== "/sign-in/email") return false;
            const proof = credentialLoginProof(context.context, session.userId);
            return proof && (await canUseAdminSession(pool, session.userId))
              ? { data: { ...proof, adminSession: true } }
              : false;
          },
        },
      },
    },
  });
}

export async function handleAdminAuth(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  pool: Pool,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const fail = (status: number, code: string) =>
    Response.json({ code }, { status, headers });
  const url = new URL(request.url);
  const path = url.pathname.slice(basePath.length);
  const read = path === "/get-session";
  if (!read && path !== "/sign-in/email" && path !== "/sign-out")
    return fail(404, "NOT_FOUND");
  if (request.method !== (read ? "GET" : "POST"))
    return fail(405, "METHOD_NOT_ALLOWED");
  if (url.search) return fail(400, "INVALID_REQUEST");
  if (!read && request.headers.get("origin") !== config.AUTH_ADMIN_ORIGIN)
    return fail(403, "INVALID_ORIGIN");
  try {
    let body: string | undefined;
    if (!read) {
      if (
        request.headers.get("content-type")?.split(";")[0] !==
        "application/json"
      )
        return fail(400, "INVALID_REQUEST");
      const raw: unknown = await request.json().catch(() => null);
      const schema =
        path === "/sign-in/email" ? adminLoginInput : z.strictObject({});
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return fail(400, "INVALID_REQUEST");
      body = JSON.stringify(parsed.data);
    }
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.delete("content-length");
    const upstream = await auth.handler(
      new Request(url, {
        method: request.method,
        headers: upstreamHeaders,
        ...(body === undefined ? {} : { body }),
      }),
    );
    if (!upstream.ok) {
      const retry = upstream.headers.get("retry-after");
      if (retry) headers.set("retry-after", retry);
      if (upstream.status === 429) return fail(429, "RATE_LIMITED");
      return fail(upstream.status >= 500 ? 503 : 401, "AUTH_REQUEST_FAILED");
    }
    if (read) {
      const raw: unknown = await upstream.json();
      if (raw === null) return Response.json(null, { headers });
      const session = internalSession.parse(raw);
      const principal = await readAdminPrincipal(
        pool,
        session.user.id,
        session.session.id,
      );
      if (!principal) return fail(403, "AUTH_REQUEST_FAILED");
      return Response.json(
        adminSession.parse({
          name: principal.name,
          role: "PLATFORM_ADMIN",
          expiresAt: principal.expiresAt.toISOString(),
        }),
        { headers },
      );
    }
    for (const cookie of upstream.headers.getSetCookie())
      headers.append("set-cookie", cookie);
    return Response.json({ success: true }, { headers });
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
