import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { birthDateInput } from "./contracts.js";
import { isDeliverableEmail } from "./email.js";

const inputSchema = z.strictObject({
  email: z
    .email()
    .transform((email) => email.toLowerCase())
    .refine(isDeliverableEmail),
  password: z.string().min(16).max(128),
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  birthDate: birthDateInput,
});

// Only a trusted server operator can call this command. No HTTP entry point.
// The operator attests ownership of the administrator's email address.
export async function createFirstAdmin(
  pool: Pool,
  input: unknown,
): Promise<boolean> {
  const data = inputSchema.parse(input);
  const hash = await hashPassword(data.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE user_profiles IN SHARE ROW EXCLUSIVE MODE");
    const existing = await client.query(
      "SELECT user_id FROM user_profiles WHERE role = 'PLATFORM_ADMIN' LIMIT 1",
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return false;
    }
    const userId = randomUUID();
    await client.query(
      'INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)',
      [userId, `${data.firstName} ${data.lastName}`, data.email],
    );
    await client.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", password) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), userId, "credential", userId, hash],
    );
    await client.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, $2, $3, 'PLATFORM_ADMIN', $4::date)`,
      [userId, data.firstName, data.lastName, data.birthDate],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
