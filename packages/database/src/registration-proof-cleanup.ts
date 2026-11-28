import type { DatabaseClient } from "./index.js";

// Use database time and skip proofs locked by concurrent finalization.
// One statement locks and deletes a bounded batch, without reading addresses.
export async function deleteExpiredRegistrationProofs(
  database: DatabaseClient,
  limit: number,
): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error("Invalid registration proof cleanup batch size");

  return database.$executeRaw`
    WITH due AS (
      SELECT token_hash
      FROM registration_email_proofs
      WHERE expires_at <= statement_timestamp()
      ORDER BY expires_at, token_hash
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM registration_email_proofs proof
    USING due
    WHERE proof.token_hash = due.token_hash
      AND proof.expires_at <= statement_timestamp()
  `;
}
