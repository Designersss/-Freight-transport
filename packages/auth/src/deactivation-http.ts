import type { Pool } from "pg";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { deactivateAccountInput } from "./contracts.js";
import { deactivateAccount } from "./deactivation.js";
import { readVerifiedSession } from "./verified-session.js";

export async function handleDeactivation(
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

  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
    return fail(403, "INVALID_ORIGIN");
  if (
    new URL(request.url).search ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return fail(400, "INVALID_REQUEST");

  try {
    const input = deactivateAccountInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) return fail(400, "INVALID_REQUEST");
    const session = await readVerifiedSession(
      request,
      config,
      auth,
      headers,
      pool,
    );
    if (session instanceof Response) return session;
    const result = await deactivateAccount(
      pool,
      { userId: session.user.id, sessionId: session.session.id },
      telegramEnabled(config),
    );
    if (result === "denied") return fail(403, "AUTH_REQUEST_FAILED");
    if (result === "session-not-fresh") return fail(403, "SESSION_NOT_FRESH");

    // The database commit has already revoked every session. Ask Better Auth
    // to expire the browser cookie as well, without changing the commit result.
    try {
      const upstreamHeaders = new Headers(request.headers);
      upstreamHeaders.delete("content-length");
      const logout = await auth.handler(
        new Request(
          new URL(`${AUTH_BASE_PATH}/sign-out`, config.AUTH_BASE_URL),
          {
            method: "POST",
            headers: upstreamHeaders,
            body: "{}",
          },
        ),
      );
      if (logout.ok)
        for (const cookie of logout.headers.getSetCookie())
          headers.append("set-cookie", cookie);
    } catch {
      // The old cookie cannot authenticate even if expiry delivery fails.
    }
    return Response.json({ success: true }, { headers });
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
