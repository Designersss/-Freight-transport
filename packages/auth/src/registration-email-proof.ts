import type { Pool } from "pg";
import { isDeliverableEmail } from "./email.js";
import {
  createRegistrationEmailToken,
  REGISTRATION_EMAIL_TTL_SECONDS,
  registrationEmailProofHash,
} from "./registration-email-token.js";

// Internal delivery material only. No account, password, role, profile or
// username is reserved by an anonymous request for a registration link.
export async function issueRegistrationEmailProof(pool: Pool, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!isDeliverableEmail(normalized))
    throw new Error("Invalid registration email");
  const { token, hash } = createRegistrationEmailToken();
  await pool.query(
    `DELETE FROM registration_email_proofs WHERE token_hash IN (
       SELECT token_hash FROM registration_email_proofs
       WHERE expires_at <= clock_timestamp()
       ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
     )`,
  );
  await pool.query(
    `INSERT INTO registration_email_proofs (token_hash, email, expires_at)
     VALUES ($1, $2, clock_timestamp() + $3 * interval '1 second')`,
    [hash, normalized, REGISTRATION_EMAIL_TTL_SECONDS],
  );
  return token;
}

// Reading never spends the link: mail scanners and page loads cannot
// consume it. Finalization must use the SQL consume function atomically.
export async function readRegistrationEmailProof(pool: Pool, token: unknown) {
  const hash = registrationEmailProofHash(token);
  if (!hash) return null;
  const result = await pool.query<{ email: string }>(
    `SELECT email FROM registration_email_proofs
     WHERE token_hash = $1 AND expires_at > clock_timestamp()`,
    [hash],
  );
  return result.rows[0]?.email ?? null;
}
