import type { Pool } from "pg";
import { isDeliverableEmail } from "./email.js";

export interface CredentialLogin {
  userId: string;
  email: string;
  revision: number;
}

function requestProof(proof: CredentialLogin | undefined) {
  if (proof) return { context: { context: { movaroCredentialLogin: proof } } };
}

// Capture before Better Auth reads and verifies the credential. A concurrent
// rotation can invalidate this attempt, but cannot turn it into a valid login.
export async function prepareCredentialLogin(pool: Pool, email: unknown) {
  if (typeof email !== "string" || !isDeliverableEmail(email)) return;
  const result = await pool.query<CredentialLogin>(
    `SELECT id AS "userId", email, "credentialRevision" AS revision
     FROM "user" WHERE email = $1`,
    [email.toLowerCase()],
  );
  return requestProof(result.rows[0]);
}

export async function preparePasswordChange(
  pool: Pool,
  userId: string,
  sessionId: string,
) {
  const result = await pool.query<CredentialLogin>(
    `SELECT u.id AS "userId", u.email, u."credentialRevision" AS revision
     FROM "user" u
     JOIN "session" s ON s."userId" = u.id
     JOIN user_profiles p ON p.user_id = u.id
     WHERE u.id = $1 AND s.id = $2 AND NOT s."adminSession"
       AND s."expiresAt" > clock_timestamp()
       AND u."emailVerified" AND u.email NOT LIKE '%.invalid'
       AND u.username IS NOT NULL AND u."registrationDraft" IS NULL
       AND p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'`,
    [userId, sessionId],
  );
  return requestProof(result.rows[0]);
}

export async function preparePasswordReset(pool: Pool, token: unknown) {
  if (typeof token !== "string" || !token) return;
  const result = await pool.query<CredentialLogin>(
    `SELECT u.id AS "userId", u.email, u."credentialRevision" AS revision
     FROM "verification" v JOIN "user" u ON u.id = v.value
     WHERE v.identifier = $1 AND v."expiresAt" > clock_timestamp()
       AND v."resetEmail" = u.email
       AND v."resetRevision" = u."credentialRevision"
     ORDER BY v."createdAt" DESC LIMIT 1`,
    [`reset-password:${token}`],
  );
  return requestProof(result.rows[0]);
}

// Only server-side middleware supplies this request context. No client
// payload or header is used as the revision proof.
export function readCredentialProof(context: unknown): CredentialLogin | null {
  if (
    !context ||
    typeof context !== "object" ||
    !("movaroCredentialLogin" in context)
  )
    return null;
  const proof = context.movaroCredentialLogin;
  if (
    !proof ||
    typeof proof !== "object" ||
    !("userId" in proof) ||
    typeof proof.userId !== "string" ||
    !("email" in proof) ||
    typeof proof.email !== "string" ||
    !("revision" in proof) ||
    typeof proof.revision !== "number" ||
    !Number.isSafeInteger(proof.revision) ||
    proof.revision < 0
  )
    return null;
  return { userId: proof.userId, email: proof.email, revision: proof.revision };
}

export function credentialLoginProof(context: unknown, userId: string) {
  const proof = readCredentialProof(context);
  if (proof?.userId !== userId) return null;
  return { emailLoginProof: proof.email, emailLoginRevision: proof.revision };
}
