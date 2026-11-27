import type { Pool, PoolClient } from "pg";
import type { z } from "zod";
import { eligibleAccount } from "./active-account.js";
import { publicRole } from "./contracts.js";

export type PublicRole = z.infer<typeof publicRole>;

export interface PublicPrincipal {
  userId: string;
  sessionId: string;
  role: PublicRole;
}

// Only use an identity derived from a validated Better Auth session.
// Read the role and active session together, never from browser input.
export async function readPublicPrincipal(
  database: Pool | PoolClient,
  identity: { userId: string; sessionId: string },
  allowTelegram: boolean,
): Promise<PublicPrincipal | null> {
  const result = await database.query<{ role: unknown }>(
    `SELECT p.role ${eligibleAccount}
       AND u.username IS NOT NULL
       AND ($3::boolean OR u."emailVerified")`,
    [identity.userId, identity.sessionId, allowTelegram],
  );
  const role = publicRole.safeParse(result.rows[0]?.role);
  return role.success ? { ...identity, role: role.data } : null;
}

// A role check is not a company membership or object ownership check.
export function hasPublicRole(
  principal: PublicPrincipal,
  required: PublicRole,
): boolean {
  return principal.role === required;
}
