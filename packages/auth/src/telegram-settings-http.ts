import type { Pool } from "pg";
import type { EmailAuth } from "./auth.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { publicTelegramSettings, telegramSettingsAction } from "./contracts.js";
import { readTelegramSettings, unlinkTelegram } from "./telegram-settings.js";
import { readVerifiedSession } from "./verified-session.js";

export async function handleTelegramSettings(
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

  if (request.method !== "GET" && request.method !== "POST")
    return fail(405, "METHOD_NOT_ALLOWED");
  if (new URL(request.url).search) return fail(400, "INVALID_REQUEST");
  if (request.method === "POST") {
    if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
      return fail(403, "INVALID_ORIGIN");
    if (
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      return fail(400, "INVALID_REQUEST");
    if (
      !telegramSettingsAction.safeParse(
        await request.json().catch(() => null),
      ).success
    )
      return fail(400, "INVALID_REQUEST");
  }

  try {
    const session = await readVerifiedSession(
      request,
      config,
      auth,
      headers,
      pool,
    );
    if (session instanceof Response) return session;
    const identity = {
      userId: session.user.id,
      sessionId: session.session.id,
    };
    if (request.method === "GET") {
      const current = await readTelegramSettings(pool, identity);
      if (!current) return fail(403, "AUTH_REQUEST_FAILED");
      return Response.json(
        publicTelegramSettings.parse({
          linked: current.linked,
          // Link start remains closed until callback authorization is added.
          canLink: false,
          canUnlink: current.linked && current.credential,
          requiresFreshSession:
            current.credential &&
            (current.linked || telegramEnabled(config)) &&
            !current.fresh,
        }),
        { headers },
      );
    }
    const result = await unlinkTelegram(pool, identity);
    switch (result) {
      case "unlinked":
        return Response.json({ success: true }, { headers });
      case "last-method":
        return fail(409, "LAST_AUTH_METHOD");
      case "session-not-fresh":
        return fail(403, "SESSION_NOT_FRESH");
      case "denied":
        return fail(403, "AUTH_REQUEST_FAILED");
    }
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
