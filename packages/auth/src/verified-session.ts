import type { Pool } from "pg";
import { z } from "zod";
import { canUsePublicSession } from "./active-account.js";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { publicSession } from "./contracts.js";
import { isDeliverableEmail } from "./email.js";
import { readTelegramAccess } from "./telegram-registration.js";

export const internalSession = publicSession.extend({
  user: publicSession.shape.user.extend({ email: z.string() }),
  session: publicSession.shape.session.extend({ id: z.string() }),
});

type InternalSession = z.infer<typeof internalSession>;
type SessionAccess = "email" | "onboarding" | "active" | "denied";

export async function sessionAccess(
  pool: Pool,
  config: AuthConfig,
  session: InternalSession,
): Promise<SessionAccess> {
  if (
    session.user.emailVerified &&
    isDeliverableEmail(session.user.email) &&
    (await canUsePublicSession(pool, session.user.id))
  )
    return "email";
  if (!telegramEnabled(config)) return "denied";
  return readTelegramAccess(pool, {
    userId: session.user.id,
    sessionId: session.session.id,
  });
}

export function toPublicSession(
  session: InternalSession,
  access: Exclude<SessionAccess, "denied">,
) {
  return publicSession.parse({
    user: {
      ...session.user,
      email: access === "email" ? session.user.email : null,
      emailVerified: access === "email",
    },
    session: session.session,
  });
}

// Keep the session id and provider identity addresses internal.
export async function readAuthSession(
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
  return internalSession.parse(raw);
}

export async function readVerifiedSession(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  headers: Headers,
  pool: Pool,
  allowOnboarding = false,
) {
  const session = await readAuthSession(request, config, auth, headers);
  if (session instanceof Response) return session;
  const access = await sessionAccess(pool, config, session);
  if (access === "denied" || (access === "onboarding" && !allowOnboarding))
    return Response.json(
      { code: "AUTH_REQUEST_FAILED" },
      { status: 403, headers },
    );
  return { ...session, access };
}
