import type { Pool } from "pg";

const adminOwner = `FROM "user" u JOIN user_profiles p ON p.user_id = u.id
  WHERE u.id = $1 AND p.role = 'PLATFORM_ADMIN' AND p.status = 'ACTIVE'
    AND u."emailVerified" AND u.email NOT LIKE '%.invalid'
    AND u."registrationDraft" IS NULL
    AND EXISTS (
      SELECT 1 FROM "account" a WHERE a."userId" = u.id
        AND a."providerId" = 'credential' AND a.password IS NOT NULL AND a.password <> ''
    )`;

export async function canUseAdminSession(pool: Pool, userId: string) {
  const result = await pool.query(`SELECT u.id ${adminOwner}`, [userId]);
  return result.rowCount === 1;
}

export async function isPlatformAdminEmail(pool: Pool, email: string) {
  const result = await pool.query(
    `SELECT u.id FROM "user" u JOIN user_profiles p ON p.user_id = u.id
     WHERE u.email = $1 AND p.role = 'PLATFORM_ADMIN'`,
    [email.toLowerCase()],
  );
  return result.rowCount === 1;
}

export async function readAdminPrincipal(
  pool: Pool,
  userId: string,
  sessionId: string,
) {
  const result = await pool.query<{ name: string; expiresAt: Date }>(
    `SELECT u.name, (SELECT "expiresAt" FROM "session" WHERE id = $2) AS "expiresAt"
     ${adminOwner}
     AND EXISTS (
       SELECT 1 FROM "session" live
       WHERE live.id = $2 AND live."userId" = u.id AND live."adminSession"
         AND live."expiresAt" > clock_timestamp()
     )
     `,
    [userId, sessionId],
  );
  return result.rows[0] ?? null;
}
