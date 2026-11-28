import type { Pool } from "pg";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import {
  emailChangeInput,
  emailChangeResponse,
  emailChangeTokenInput,
} from "./contracts.js";
import type { AuthMailer } from "./email.js";
import {
  beginEmailChange,
  confirmEmailChange,
  discardEmailChangeDelivery,
  type EmailChangeDelivery,
} from "./email-change.js";
import {
  reserveEmailChangeRequest,
  reserveMailRequest,
} from "./mail-rate-limit.js";
import { readVerifiedSession } from "./verified-session.js";

export async function handleEmailChange(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  pool: Pool,
  mailer: AuthMailer,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const fail = (status: number, code: string) =>
    Response.json({ code }, { status, headers });
  const success = (stage: "old-sent" | "new-sent" | "completed") =>
    Response.json(emailChangeResponse.parse({ stage }), { headers });
  const limited = (retry: number) => {
    headers.set("retry-after", String(retry));
    return fail(429, "RATE_LIMITED");
  };
  const url = new URL(request.url);
  const start = url.pathname === `${AUTH_BASE_PATH}/email/change`;
  if (!start && url.pathname !== `${AUTH_BASE_PATH}/email/change/confirm`)
    return fail(404, "NOT_FOUND");
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
    return fail(403, "INVALID_ORIGIN");
  if (
    url.search ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return fail(400, "INVALID_REQUEST");

  async function deliver(result: EmailChangeDelivery) {
    try {
      const retry = await reserveMailRequest(
        pool,
        config.AUTH_SECRET,
        "email-change",
        result.email,
      );
      if (retry !== null) {
        await discardEmailChangeDelivery(pool, result.token);
        return limited(retry);
      }
      const link = new URL(
        `/${result.locale}/email-change-confirmation`,
        config.AUTH_WEB_ORIGIN,
      );
      link.hash = `token=${result.token}`;
      await mailer.send(
        result.stage === "old" ? "email-change-old" : "email-change-new",
        result.email,
        link.href,
      );
      return success(result.stage === "old" ? "old-sent" : "new-sent");
    } catch {
      await discardEmailChangeDelivery(pool, result.token);
      return fail(503, "AUTH_REQUEST_FAILED");
    }
  }

  try {
    const raw: unknown = await request.json().catch(() => null);
    if (start) {
      const parsed = emailChangeInput.safeParse(raw);
      if (!parsed.success) return fail(400, "INVALID_REQUEST");
      const session = await readVerifiedSession(
        request,
        config,
        auth,
        headers,
        pool,
      );
      if (session instanceof Response) return session;
      if (session.access !== "email") return fail(403, "AUTH_REQUEST_FAILED");
      const retry = await reserveEmailChangeRequest(
        pool,
        config.AUTH_SECRET,
        "start",
        session.user.id,
      );
      if (retry !== null) return limited(retry);
      const result = await beginEmailChange(
        pool,
        { userId: session.user.id, sessionId: session.session.id },
        parsed.data,
      );
      if (result.kind === "deliver") return await deliver(result);
      if (result.kind === "denied") return fail(403, "SESSION_NOT_FRESH");
      return fail(400, "INVALID_REQUEST");
    }
    const parsed = emailChangeTokenInput.safeParse(raw);
    if (!parsed.success) return fail(400, "INVALID_REQUEST");
    // Use the trusted API peer header, never a caller-provided forwarded IP.
    const retry = await reserveEmailChangeRequest(
      pool,
      config.AUTH_SECRET,
      "confirm",
      request.headers.get("x-movaro-client-ip") ?? "unknown",
    );
    if (retry !== null) return limited(retry);
    const result = await confirmEmailChange(pool, parsed.data);
    if (result.kind === "deliver") return await deliver(result);
    if (result.kind === "completed") return success("completed");
    // Do not distinguish used, expired, unknown, or occupied destinations.
    return fail(400, "INVALID_REQUEST");
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
