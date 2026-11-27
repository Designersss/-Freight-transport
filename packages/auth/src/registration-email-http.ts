import type { Pool } from "pg";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import {
  publicSession,
  registrationEmailAddress,
  registrationEmailComplete,
  registrationEmailRead,
  registrationEmailStart,
} from "./contracts.js";
import type { AuthMailer } from "./email.js";
import {
  reserveMailRequest,
  reserveRegistrationRequest,
} from "./mail-rate-limit.js";
import { usernameOwner } from "./registration.js";
import { registrationContext } from "./registration-context.js";
import {
  issueRegistrationEmailProof,
  readRegistrationEmailProof,
} from "./registration-email-proof.js";
import { registrationEmailProofHash } from "./registration-email-token.js";

async function emailOwner(pool: Pool, email: string) {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email = $1',
    [email],
  );
  return result.rows[0]?.id ?? null;
}

export async function handleEmailRegistration(
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
  const success = () => Response.json({ success: true }, { headers });
  const limited = (retry: string) => {
    headers.set("retry-after", retry);
    return fail(429, "RATE_LIMITED");
  };
  const url = new URL(request.url);
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
    return fail(403, "INVALID_ORIGIN");
  if (
    url.search ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return fail(400, "INVALID_REQUEST");
  const raw: unknown = await request.json().catch(() => null);
  const path = url.pathname.slice(AUTH_BASE_PATH.length);
  try {
    if (path === "/registration/email/start") {
      const parsed = registrationEmailStart.safeParse(raw);
      if (!parsed.success) return fail(400, "INVALID_REQUEST");
      const { email, locale } = parsed.data;
      const retry = await reserveMailRequest(
        pool,
        config.AUTH_SECRET,
        "verification",
        email,
        request.headers.get("x-movaro-client-ip"),
      );
      if (retry !== null) return limited(String(retry));
      // Send the same proof to any deliverable address. Account existence is
      // disclosed only to a caller who possesses the mailbox proof.
      const token = await issueRegistrationEmailProof(pool, email);
      const link = new URL(`/${locale}/signup`, config.AUTH_WEB_ORIGIN);
      link.hash = `token=${token}`;
      try {
        await mailer.send("registration-email", email, link.href);
      } catch {
        const hash = registrationEmailProofHash(token);
        await pool.query(
          "DELETE FROM registration_email_proofs WHERE token_hash = $1",
          [hash],
        );
        return fail(503, "AUTH_REQUEST_FAILED");
      }
      return success();
    }
    if (path === "/registration/email/read") {
      const parsed = registrationEmailRead.safeParse(raw);
      if (!parsed.success) return fail(400, "INVALID_REQUEST");
      const retry = await reserveRegistrationRequest(
        pool,
        config.AUTH_SECRET,
        "read",
        request.headers.get("x-movaro-client-ip"),
      );
      if (retry !== null) return limited(String(retry));
      const email = await readRegistrationEmailProof(pool, parsed.data.token);
      if (!email) return fail(400, "INVALID_REQUEST");
      if (await emailOwner(pool, email))
        return fail(409, "AUTH_REQUEST_FAILED");
      return Response.json(registrationEmailAddress.parse({ email }), {
        headers,
      });
    }
    if (path !== "/registration/email/complete") return fail(404, "NOT_FOUND");
    const parsed = registrationEmailComplete.safeParse(raw);
    if (!parsed.success) return fail(400, "INVALID_REQUEST");
    const retry = await reserveRegistrationRequest(
      pool,
      config.AUTH_SECRET,
      "complete",
      request.headers.get("x-movaro-client-ip"),
    );
    if (retry !== null) return limited(String(retry));
    const { token, password, registration } = parsed.data;
    const proofHash = registrationEmailProofHash(token);
    const email = await readRegistrationEmailProof(pool, token);
    if (!proofHash || !email) return fail(400, "INVALID_REQUEST");
    if (await emailOwner(pool, email)) return fail(409, "AUTH_REQUEST_FAILED");
    if (await usernameOwner(pool, registration.username))
      return fail(409, "USERNAME_TAKEN");

    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.delete("content-length");
    // No browser session is needed to create an email account.
    upstreamHeaders.delete("cookie");
    const response = await registrationContext.run(
      { email, proofHash, registration },
      () =>
        auth.handler(
          new Request(new URL(`${AUTH_BASE_PATH}/sign-up/email`, url.origin), {
            method: "POST",
            headers: upstreamHeaders,
            body: JSON.stringify({
              email,
              password,
              name: `${registration.profile.firstName} ${registration.profile.lastName}`,
            }),
          }),
        ),
    );
    if (response.status === 429)
      return limited(
        response.headers.get("retry-after") ??
          response.headers.get("x-retry-after") ??
          "10",
      );
    if (!response.ok) {
      if (await usernameOwner(pool, registration.username))
        return fail(409, "USERNAME_TAKEN");
      if (await emailOwner(pool, email))
        return fail(409, "AUTH_REQUEST_FAILED");
      if (!(await readRegistrationEmailProof(pool, token)))
        return fail(400, "INVALID_REQUEST");
      return fail(response.status, "AUTH_REQUEST_FAILED");
    }
    // Better Auth returns opaque synthetic success on duplicate signup.
    // Confirm the returned identity actually committed, not a synthetic user.
    const rawResult: unknown = await response.json();
    if (!rawResult || typeof rawResult !== "object" || !("user" in rawResult))
      return fail(503, "AUTH_REQUEST_FAILED");
    const user = publicSession.shape.user.safeParse(rawResult.user);
    if (
      !user.success ||
      !user.data.emailVerified ||
      user.data.id !== (await emailOwner(pool, email)) ||
      user.data.id !== (await usernameOwner(pool, registration.username))
    )
      return fail(409, "AUTH_REQUEST_FAILED");
    return success();
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
