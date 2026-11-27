import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { eligibleAccount } from "./active-account.js";

export interface PhotoSession {
  userId: string;
  sessionId: string;
}

type PhotoChange = "updated" | "forbidden" | "reservation-expired";

export async function readProfilePhotoKey(
  pool: Pool,
  session: PhotoSession,
): Promise<string | null | undefined> {
  const result = await pool.query<{ photo_key: string | null }>(
    `SELECT p.photo_key ${eligibleAccount}`,
    [session.userId, session.sessionId],
  );
  return result.rows[0]?.photo_key;
}

// Reserve before writing to S3 so a crash cannot lose the cleanup candidate.
export async function reserveProfilePhotoKey(
  pool: Pool,
  session: PhotoSession,
): Promise<string | null> {
  const key = `profile-photos/${randomUUID()}`;
  const result = await pool.query(
    `INSERT INTO profile_photo_cleanup (key, owner_id, available_at)
     SELECT $3, u.id, clock_timestamp() + interval '10 minutes'
     ${eligibleAccount}
     RETURNING key`,
    [session.userId, session.sessionId, key],
  );
  return result.rowCount === 1 ? key : null;
}

// A key is attachable once, only by the owner of a live reservation.
// No storage network operation runs inside this transaction.
export async function changeProfilePhoto(
  pool: Pool,
  session: PhotoSession,
  key: string | null,
): Promise<PhotoChange> {
  const client = await pool.connect();
  const identity = [session.userId, session.sessionId];
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT u.id ${eligibleAccount} FOR UPDATE OF u, p, s`,
      identity,
    );
    const current = locked.rowCount
      ? (
          await client.query<{ photo_key: string | null }>(
            `SELECT p.photo_key ${eligibleAccount}`,
            identity,
          )
        ).rows[0]
      : undefined;
    if (!current) {
      await client.query("ROLLBACK");
      return "forbidden";
    }
    if (key !== null) {
      const reservation = await client.query(
        `DELETE FROM profile_photo_cleanup
         WHERE key = $1 AND owner_id = $2 AND available_at > clock_timestamp()
         RETURNING key`,
        [key, session.userId],
      );
      if (!reservation.rowCount) {
        await client.query("ROLLBACK");
        return "reservation-expired";
      }
    }
    if (current.photo_key !== key) {
      await client.query(
        "UPDATE user_profiles SET photo_key = $2, updated_at = clock_timestamp() WHERE user_id = $1",
        [session.userId, key],
      );
      if (current.photo_key !== null) {
        await client.query(
          `INSERT INTO profile_photo_cleanup (key, available_at)
           VALUES ($1, clock_timestamp())`,
          [current.photo_key],
        );
      }
    }
    await client.query("COMMIT");
    return "updated";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
