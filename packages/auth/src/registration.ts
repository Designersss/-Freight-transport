import type { Pool } from "pg";
import { z } from "zod";
import { profileInput, publicSession } from "./contracts.js";

const signedInUser = z.object({ user: publicSession.shape.user });

export async function usernameOwner(
  pool: Pool,
  username: string,
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM "user" WHERE username = $1',
    [username],
  );
  return result.rows[0]?.id ?? null;
}

export async function completeRegistration(pool: Pool, response: unknown) {
  const { user } = signedInUser.parse(response);
  if (!user.emailVerified) throw new Error("Unverified registration");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ registrationDraft: string | null }>(
      'SELECT "registrationDraft" FROM "user" WHERE id = $1 AND "emailVerified" = true FOR UPDATE',
      [user.id],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Registration owner unavailable");
    if (row.registrationDraft !== null) {
      const profile = profileInput.parse(JSON.parse(row.registrationDraft));
      await client.query(
        `INSERT INTO user_profiles (user_id, first_name, last_name, role, company_name, birth_date)
         VALUES ($1, $2, $3, $4, $5, $6::date)`,
        [
          user.id,
          profile.firstName,
          profile.lastName,
          profile.role,
          profile.companyName ?? null,
          profile.birthDate,
        ],
      );
      await client.query(
        'UPDATE "user" SET "registrationDraft" = NULL WHERE id = $1',
        [user.id],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
