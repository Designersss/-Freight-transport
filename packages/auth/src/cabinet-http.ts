import type { Pool } from "pg";
import type { EmailAuth } from "./auth.js";
import { type AuthConfig, telegramEnabled } from "./config.js";
import { publicCabinet } from "./contracts.js";
import {
  hasPublicRole,
  type PublicRole,
  readPublicPrincipal,
} from "./public-principal.js";
import { readAuthSession } from "./verified-session.js";

const cabinetRoles = {
  "/cabinet/company-owner": "COMPANY_OWNER",
  "/cabinet/dispatcher": "DISPATCHER",
  "/cabinet/driver": "DRIVER",
} as const satisfies Record<string, PublicRole>;

export function cabinetRole(path: string): PublicRole | undefined {
  return Object.hasOwn(cabinetRoles, path)
    ? cabinetRoles[path as keyof typeof cabinetRoles]
    : undefined;
}

export async function handleCabinet(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  pool: Pool,
  required: PublicRole,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  const fail = (status: number, code: string) =>
    Response.json({ code }, { status, headers });

  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED");
  if (new URL(request.url).search) return fail(400, "INVALID_REQUEST");
  try {
    const session = await readAuthSession(request, config, auth, headers);
    if (session instanceof Response) return session;
    const principal = await readPublicPrincipal(
      pool,
      { userId: session.user.id, sessionId: session.session.id },
      telegramEnabled(config),
    );
    if (!principal || !hasPublicRole(principal, required))
      return fail(403, "AUTH_REQUEST_FAILED");
    return Response.json(publicCabinet.parse({ role: principal.role }), {
      headers,
    });
  } catch {
    return fail(503, "AUTH_REQUEST_FAILED");
  }
}
