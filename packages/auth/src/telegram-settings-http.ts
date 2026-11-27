import type { Pool } from "pg";
import type { EmailAuth } from "./auth.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { publicTelegramSettings } from "./contracts.js";
import { readTelegramSettings } from "./telegram-settings.js";
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

  if (request.method !== "GET")
    return fail(405, "METHOD_NOT_ALLOWED");
  if (new URL(request.url).search) return fail(400, "INVALID_REQUEST");
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
    const current = await readTelegramSettings(pool, identity);
    if (!current) return fail(403, "AUTH_REQUEST_FAILED");
    const canLink =
      telegramEnabled(config) && !current.linked && current.credential;
    return Response.json(
      publicTelegramSettings.parse({
        linked: current.linked,
        canLink,
        requiresFreshSession: canLink && !current.fresh,
      }),
      { headers },
    );
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
