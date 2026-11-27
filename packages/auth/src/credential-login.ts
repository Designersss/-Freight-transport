import type { Pool } from "pg";
import { isDeliverableEmail } from "./email.js";

interface CredentialLogin {
  userId: string;
  email: string;
  revision: number;
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
  const proof = result.rows[0];
  if (proof) return { context: { context: { movaroCredentialLogin: proof } } };
}

// Only server-side middleware supplies this request context. No client
// payload or header is used as the revision proof.
export function credentialLoginProof(context: unknown, userId: string) {
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
    proof.userId !== userId ||
    !("email" in proof) ||
    typeof proof.email !== "string" ||
    !("revision" in proof) ||
    typeof proof.revision !== "number" ||
    !Number.isSafeInteger(proof.revision) ||
    proof.revision < 0
  )
    return null;
  return { emailLoginProof: proof.email, emailLoginRevision: proof.revision };
}
