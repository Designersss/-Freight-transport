import type { Pool } from "pg";

// Use the same identity predicate in session issuance, onboarding and guards.
// A reserved address is never treated as proof of email ownership.
export const telegramAccountCondition = `NOT u."emailVerified"
  AND u."registrationDraft" IS NULL
  AND EXISTS (
    SELECT 1 FROM "account" telegram
    WHERE telegram."userId" = u.id AND telegram."providerId" = 'telegram'
      AND u.email = encode(sha256(convert_to(telegram."accountId", 'UTF8')), 'hex') || '@telegram.invalid'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "account" credential
    WHERE credential."userId" = u.id AND credential."providerId" = 'credential'
  )`;

const emailAccountCondition = `u."emailVerified" = true
  AND u."registrationDraft" IS NULL
  AND u.email NOT LIKE '%.invalid'`;

export const eligibleAccount = `FROM "user" u
  JOIN user_profiles p ON p.user_id = u.id
  JOIN "session" s ON s."userId" = u.id
  WHERE u.id = $1 AND s.id = $2 AND s."expiresAt" > clock_timestamp()
    AND u."registrationDraft" IS NULL
    AND p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'
    AND ( (${emailAccountCondition})
      OR (u.username IS NOT NULL AND ${telegramAccountCondition}) )`;

export async function canUsePublicSession(
  pool: Pool,
  userId: string,
  allowTelegram = false,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT u.id FROM "user" u
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id = $1
       AND (p.user_id IS NULL OR (p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'))
       AND (
         (${emailAccountCondition})
         OR ($2::boolean AND ${telegramAccountCondition}
           AND ((p.user_id IS NULL AND u.username IS NULL)
             OR (p.user_id IS NOT NULL AND u.username IS NOT NULL)))
       )`,
    [userId, allowTelegram],
  );
  return result.rowCount === 1;
}

// Public recovery must not issue credentials to administrators or inactive users.
export async function isRestrictedPublicEmail(pool: Pool, email: string) {
  const result = await pool.query(
    `SELECT u.id FROM "user" u JOIN user_profiles p ON p.user_id = u.id
     WHERE u.email = $1 AND (p.role = 'PLATFORM_ADMIN' OR p.status <> 'ACTIVE')`,
    [email.toLowerCase()],
  );
  return result.rowCount === 1;
}
