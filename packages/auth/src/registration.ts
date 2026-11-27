import type { Pool } from "pg";

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
