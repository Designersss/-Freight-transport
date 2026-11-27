import type { Pool } from "pg";
import type { z } from "zod";
import { eligibleAccount } from "./active-account.js";
import type { EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import { profileSettingsInput, publicProfile } from "./contracts.js";
import { readVerifiedSession } from "./verified-session.js";

const columns = `first_name AS "firstName", last_name AS "lastName", role, status, company_name AS "companyName", to_char(birth_date::timestamp, 'YYYY-MM-DD') AS "birthDate"`;

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

  if (request.method !== "GET") {
    headers.set("allow", "GET");
    return fail(405, "METHOD_NOT_ALLOWED");
  }
  if (new URL(request.url).search) return fail(400, "INVALID_REQUEST");

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
    // Only the verified Telegram identity has an incomplete-profile state.
    if (session.access === "onboarding")
      return Response.json(null, { headers });

    const result = await pool.query(
      `SELECT ${columns} ${eligibleAccount}
       AND u.username IS NOT NULL AND NOT s."adminSession"`,
      [session.user.id, session.session.id],
    );
    const row: unknown = result.rows[0];
    if (row === undefined) return fail(403, "AUTH_REQUEST_FAILED");
    return Response.json(publicProfile.parse(row), { headers });
  } catch {
    return fail(500, "AUTH_REQUEST_FAILED");
  }
}

// Keep the auth display name and the domain profile in one transaction.
// Account identity, role, username, email and company data are not mutable here.
async function updatePersonalData(
  pool: Pool,
  userId: string,
  sessionId: string,
  input: z.infer<typeof profileSettingsInput>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identity = [userId, sessionId];
    const locked = await client.query(
      `SELECT u.id ${eligibleAccount} FOR UPDATE OF u, p, s`,
      identity,
    );
    const eligible = locked.rowCount
      ? await client.query(`SELECT u.id ${eligibleAccount}`, identity)
      : null;
    if (!eligible?.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const result = await client.query(
      `UPDATE user_profiles SET first_name = $2, last_name = $3,
         birth_date = $4::date, updated_at = clock_timestamp()
       WHERE user_id = $1 RETURNING ${columns}`,
      [userId, input.firstName, input.lastName, input.birthDate],
    );
    const updated = publicProfile.parse(result.rows[0]);
    await client.query(
      'UPDATE "user" SET name = $2, "updatedAt" = clock_timestamp() WHERE id = $1',
      [userId, `${updated.firstName} ${updated.lastName}`],
    );
    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function handleProfileSettings(
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

  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (new URL(request.url).search) return fail(400, "INVALID_REQUEST");
  if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
    return fail(403, "INVALID_ORIGIN");
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return fail(400, "INVALID_REQUEST");

  try {
    const session = await readVerifiedSession(
      request,
      config,
      auth,
      headers,
      pool,
    );
    if (session instanceof Response) return session;
    const input = profileSettingsInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) return fail(400, "INVALID_REQUEST");
    const updated = await updatePersonalData(
      pool,
      session.user.id,
      session.session.id,
      input.data,
    );
    return updated
      ? Response.json(updated, { headers })
      : fail(403, "AUTH_REQUEST_FAILED");
  } catch {
    return fail(500, "AUTH_REQUEST_FAILED");
  }
}
