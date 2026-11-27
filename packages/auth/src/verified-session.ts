import { z } from "zod";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import { publicSession } from "./contracts.js";
import { isDeliverableEmail } from "./email.js";

const verifiedSession = publicSession.extend({
  session: publicSession.shape.session.extend({ id: z.string() }),
});

// Keep the session id internal; the public session DTO remains unchanged.
export async function readVerifiedSession(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  headers: Headers,
) {
  const fail = (status: number, code: string) =>
    Response.json({ code }, { status, headers });

  const sessionHeaders = new Headers(request.headers);
  sessionHeaders.delete("content-length");
  sessionHeaders.delete("content-type");
  const sessionResponse = await auth.handler(
    new Request(
      new URL(
        `${AUTH_BASE_PATH}/get-session?disableRefresh=true`,
        config.AUTH_BASE_URL,
      ),
      { method: "GET", headers: sessionHeaders },
    ),
  );
  for (const cookie of sessionResponse.headers.getSetCookie())
    headers.append("set-cookie", cookie);
  if (!sessionResponse.ok) {
    if (sessionResponse.status === 429) {
      const retry =
        sessionResponse.headers.get("retry-after") ??
        sessionResponse.headers.get("x-retry-after");
      if (retry) headers.set("retry-after", retry);
      return fail(429, "RATE_LIMITED");
    }
    return fail(503, "AUTH_REQUEST_FAILED");
  }
  const raw: unknown = await sessionResponse.json();
  if (raw === null) return fail(401, "AUTH_REQUIRED");
  const session = verifiedSession.parse(raw);
  if (!session.user.emailVerified || !isDeliverableEmail(session.user.email))
    return fail(403, "AUTH_REQUEST_FAILED");

  return session;
}
