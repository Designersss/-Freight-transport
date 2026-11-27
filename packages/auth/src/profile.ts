import type { Pool } from "pg";
import { z } from "zod";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import { profileInput, publicProfile, publicSession } from "./contracts.js";
import { isDeliverableEmail } from "./email.js";

const storedProfile = publicProfile.extend({
  role: z.enum(["PLATFORM_ADMIN", "COMPANY_OWNER", "DISPATCHER", "DRIVER"]),
  status: z.enum(["ACTIVE", "DEACTIVATED"]),
});

const columns =
  'first_name AS "firstName", last_name AS "lastName", role, status, driver_age AS "driverAge"';

async function readProfile(pool: Pool, userId: string) {
  const result = await pool.query(
    `SELECT ${columns} FROM user_profiles WHERE user_id = $1`,
    [userId],
  );
  const row: unknown = result.rows[0];
  return row === undefined ? null : storedProfile.parse(row);
}

async function insertProfile(
  pool: Pool,
  userId: string,
  input: z.infer<typeof profileInput>,
) {
  const result = await pool.query(
    `INSERT INTO user_profiles (user_id, first_name, last_name, role, driver_age)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING ${columns}`,
    [
      userId,
      input.firstName,
      input.lastName,
      input.role,
      input.driverAge ?? null,
    ],
  );
  const row: unknown = result.rows[0];
  return row === undefined ? null : publicProfile.parse(row);
}

export async function handleProfile(
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
  }

  try {
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
    const session = publicSession.parse(raw);
    if (!session.user.emailVerified || !isDeliverableEmail(session.user.email))
      return fail(403, "AUTH_REQUEST_FAILED");

    const existing = await readProfile(pool, session.user.id);
    if (
      existing &&
      (existing.status !== "ACTIVE" || existing.role === "PLATFORM_ADMIN")
    )
      return fail(403, "AUTH_REQUEST_FAILED");
    if (request.method === "GET")
      return Response.json(existing ? publicProfile.parse(existing) : null, {
        headers,
      });

    const input = profileInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) return fail(400, "INVALID_REQUEST");
    if (existing) return fail(409, "PROFILE_ALREADY_EXISTS");

    const profile = await insertProfile(pool, session.user.id, input.data);
    if (!profile) return fail(409, "PROFILE_ALREADY_EXISTS");
    return Response.json(profile, { status: 201, headers });
  } catch {
    return fail(500, "AUTH_REQUEST_FAILED");
  }
}
