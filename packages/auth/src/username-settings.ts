import type { Pool, PoolClient } from "pg";
import type { EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import { publicUsernameSettings, usernameChangeInput } from "./contracts.js";
import { readVerifiedSession } from "./verified-session.js";

interface UsernameRow {
  username: string | null;
  nextChangeAt: Date | null;
}

const eligibleAccount = `FROM "user" u
  JOIN user_profiles p ON p.user_id = u.id
  JOIN "session" s ON s."userId" = u.id
  WHERE u.id = $1 AND s.id = $2 AND s."expiresAt" > clock_timestamp()
    AND u."emailVerified" = true AND u."registrationDraft" IS NULL
    AND p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'`;

function toSettings(row: UsernameRow) {
  return publicUsernameSettings.parse({
    username: row.username,
    nextChangeAt: row.nextChangeAt?.toISOString() ?? null,
  });
}

async function readSettings(
  database: Pool | PoolClient,
  userId: string,
  sessionId: string,
) {
  const result = await database.query<UsernameRow>(
    `SELECT u.username,
       CASE WHEN u.username_changed_at + interval '168 hours' > clock_timestamp()
       THEN u.username_changed_at + interval '168 hours' END AS "nextChangeAt"
     ${eligibleAccount}`,
    [userId, sessionId],
  );
  return result.rows[0] ?? null;
}

async function changeUsername(
  pool: Pool,
  userId: string,
  sessionId: string,
  username: string,
  headers: Headers,
): Promise<Response> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize changes to one account and recheck session/profile eligibility
    // under the same locks, before consulting the database clock.
    const locked = await client.query(
      `SELECT u.id ${eligibleAccount} FOR UPDATE OF u, p, s`,
      [userId, sessionId],
    );
    const current = locked.rowCount
      ? await readSettings(client, userId, sessionId)
      : null;
    if (!current) {
      await client.query("ROLLBACK");
      return Response.json(
        { code: "AUTH_REQUEST_FAILED" },
        { status: 403, headers },
      );
    }
    if (current.username === username) {
      const unchanged = toSettings(current);
      await client.query("COMMIT");
      return Response.json(unchanged, { headers });
    }
    if (current.nextChangeAt !== null) {
      await client.query("ROLLBACK");
      return Response.json(
        {
          code: "USERNAME_CHANGE_COOLDOWN",
          nextChangeAt: current.nextChangeAt.toISOString(),
        },
        { status: 409, headers },
      );
    }
    const result = await client.query<UsernameRow>(
      `UPDATE "user" SET
         username_changed_at = CASE WHEN username IS NULL THEN NULL ELSE clock_timestamp() END,
         username = $2, "updatedAt" = clock_timestamp()
       WHERE id = $1
       RETURNING username, username_changed_at + interval '168 hours' AS "nextChangeAt"`,
      [userId, username],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Username owner unavailable");
    const updated = toSettings(row);
    await client.query("COMMIT");
    return Response.json(updated, { headers });
  } catch (error) {
    await client.query("ROLLBACK");
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505" &&
      "constraint" in error &&
      error.constraint === "user_username_uidx"
    )
      return Response.json(
        { code: "USERNAME_TAKEN" },
        { status: 409, headers },
      );
    throw error;
  } finally {
    client.release();
  }
}

export async function handleUsernameSettings(
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
    const session = await readVerifiedSession(request, config, auth, headers);
    if (session instanceof Response) return session;
    if (request.method === "GET") {
      const current = await readSettings(
        pool,
        session.user.id,
        session.session.id,
      );
      return current
        ? Response.json(toSettings(current), { headers })
        : fail(403, "AUTH_REQUEST_FAILED");
    }
    const input = usernameChangeInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) return fail(400, "INVALID_REQUEST");
    return await changeUsername(
      pool,
      session.user.id,
      session.session.id,
      input.data.username,
      headers,
    );
  } catch {
    return fail(500, "AUTH_REQUEST_FAILED");
  }
}
