import type { Pool } from "pg";
import type { EmailAuth } from "./auth.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { completeTelegramRegistration } from "./telegram-registration.js";
import { readVerifiedSession } from "./verified-session.js";

export async function handleTelegramRegistration(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  pool: Pool,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  const fail = (status: number, code: string) =>
    Response.json({ code }, { status, headers });

  if (!telegramEnabled(config)) return fail(404, "NOT_FOUND");
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
    return fail(403, "INVALID_ORIGIN");
  if (
    new URL(request.url).search ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return fail(400, "INVALID_REQUEST");

  try {
    const session = await readVerifiedSession(
      request,
      config,
      auth,
      headers,
      pool,
      true,
    );
    if (session instanceof Response) return session;
    if (session.access === "email") return fail(403, "AUTH_REQUEST_FAILED");
    const result = await completeTelegramRegistration(
      pool,
      { userId: session.user.id, sessionId: session.session.id },
      await request.json().catch(() => null),
    );
    switch (result) {
      case "created":
      case "already-complete":
        return Response.json({ success: true }, { headers });
      case "username-taken":
        return fail(409, "USERNAME_TAKEN");
      case "invalid":
        return fail(400, "INVALID_REQUEST");
      case "denied":
        return fail(403, "AUTH_REQUEST_FAILED");
    }
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
