import type { Pool } from "pg";
import { z } from "zod";
import { eligibleAccount } from "./active-account.js";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import { publicActiveSessions, sessionAction } from "./contracts.js";
import { readVerifiedSession } from "./verified-session.js";

interface SessionRow {
  id: string;
  current: boolean;
  createdAt: Date;
  expiresAt: Date;
  userAgent: string | null;
}

const revokeResult = z.object({ status: z.literal(true) });
const listLimit = 100;

export async function handleSessionSettings(
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
    const session = await readVerifiedSession(
      request,
      config,
      auth,
      headers,
      pool,
    );
    if (session instanceof Response) return session;
    const owner = [session.user.id, session.session.id];
    if (request.method === "GET") {
      const result = await pool.query<SessionRow>(
        `SELECT target.id, target.id = $2 AS current,
           target."createdAt", target."expiresAt",
           left(target."userAgent", 256) AS "userAgent"
         FROM "session" target
         WHERE target."userId" = $1 AND target."expiresAt" > clock_timestamp()
           AND EXISTS (SELECT 1 ${eligibleAccount})
         ORDER BY (target.id = $2) DESC, target."createdAt" DESC, target.id
         LIMIT $3`,
        [...owner, listLimit + 1],
      );
      if (!result.rows[0]?.current) return fail(403, "AUTH_REQUEST_FAILED");
      return Response.json(
        publicActiveSessions.parse({
          sessions: result.rows.slice(0, listLimit).map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
          })),
          hasMore: result.rows.length > listLimit,
        }),
        { headers },
      );
    }

    const input = sessionAction.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) return fail(400, "INVALID_REQUEST");
    const eligible = await pool.query(`SELECT u.id ${eligibleAccount}`, owner);
    if (!eligible.rowCount) return fail(403, "AUTH_REQUEST_FAILED");
    let path = "/revoke-other-sessions";
    let payload: Record<string, string> = {};
    if (input.data.action === "revoke") {
      if (input.data.id === session.session.id)
        return fail(409, "CURRENT_SESSION");
      const target = await pool.query<{ token: string }>(
        `SELECT token FROM "session"
         WHERE "userId" = $1 AND id = $2 AND "expiresAt" > clock_timestamp()`,
        [session.user.id, input.data.id],
      );
      const row = target.rows[0];
      if (!row) return fail(404, "SESSION_NOT_FOUND");
      path = "/revoke-session";
      payload = { token: row.token };
    }
    // Only the server translates an owned id to Better Auth's secret token.
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.delete("content-length");
    const response = await auth.handler(
      new Request(new URL(`${AUTH_BASE_PATH}${path}`, config.AUTH_BASE_URL), {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(payload),
      }),
    );
    for (const cookie of response.headers.getSetCookie())
      headers.append("set-cookie", cookie);
    if (!response.ok) {
      const retry =
        response.headers.get("retry-after") ??
        response.headers.get("x-retry-after");
      if (retry) headers.set("retry-after", retry);
      return fail(
        response.status,
        response.status === 429 ? "RATE_LIMITED" : "AUTH_REQUEST_FAILED",
      );
    }
    if (!revokeResult.safeParse(await response.json()).success)
      return fail(503, "AUTH_REQUEST_FAILED");
    return Response.json({ success: true }, { headers });
  } catch {
    return fail(500, "AUTH_REQUEST_FAILED");
  }
}
