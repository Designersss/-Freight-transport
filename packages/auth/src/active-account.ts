import type { Pool } from "pg";

export const eligibleAccount = `FROM "user" u
  JOIN user_profiles p ON p.user_id = u.id
  JOIN "session" s ON s."userId" = u.id
  WHERE u.id = $1 AND s.id = $2 AND s."expiresAt" > clock_timestamp()
    AND u."emailVerified" = true AND u."registrationDraft" IS NULL
    AND p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'`;

export async function canUsePublicSession(
  pool: Pool,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT u.id FROM "user" u
     WHERE u.id = $1 AND u."emailVerified" = true
       AND NOT EXISTS (
         SELECT 1 FROM user_profiles p WHERE p.user_id = u.id
           AND (p.status <> 'ACTIVE' OR p.role = 'PLATFORM_ADMIN')
       )`,
    [userId],
  );
  return result.rowCount === 1;
}
