import type { DatabaseClient } from "./index.js";

export interface ProfilePhotoCleanupClaim {
  key: string;
  attempts: number;
}

// Claim and fence a bounded batch before any storage I/O. Expired upload
// reservations are no longer attachable once owner_id has been cleared.
export async function claimProfilePhotoCleanup(
  database: DatabaseClient,
  limit: number,
): Promise<ProfilePhotoCleanupClaim[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("Invalid profile photo cleanup batch size");

  return database.$queryRaw<ProfilePhotoCleanupClaim[]>`
    WITH due AS (
      SELECT cleanup.key
      FROM profile_photo_cleanup cleanup
      WHERE cleanup.available_at <= clock_timestamp()
        AND NOT EXISTS (
          SELECT 1 FROM user_profiles p WHERE p.photo_key = cleanup.key
        )
      ORDER BY cleanup.available_at, cleanup.key
      LIMIT ${limit}
      FOR UPDATE OF cleanup SKIP LOCKED
    )
    UPDATE profile_photo_cleanup cleanup
    SET owner_id = NULL,
        attempts = cleanup.attempts + 1,
        available_at = clock_timestamp() + interval '10 minutes'
    FROM due
    WHERE cleanup.key = due.key
    RETURNING cleanup.key, cleanup.attempts
  `;
}

export async function completeProfilePhotoCleanup(
  database: DatabaseClient,
  claim: ProfilePhotoCleanupClaim,
): Promise<boolean> {
  const result = await database.profilePhotoCleanup.deleteMany({
    where: { key: claim.key, attempts: claim.attempts, ownerId: null },
  });
  return result.count === 1;
}

// A failed delete remains durable. Delay subsequent attempts without losing it.
export async function deferProfilePhotoCleanup(
  database: DatabaseClient,
  claim: ProfilePhotoCleanupClaim,
): Promise<boolean> {
  const delay = Math.min(3600, 30 * 2 ** Math.min(claim.attempts, 7));
  const result = await database.$executeRaw`
    UPDATE profile_photo_cleanup
    SET available_at = clock_timestamp() + ${delay} * interval '1 second'
    WHERE key = ${claim.key} AND attempts = ${claim.attempts}
      AND owner_id IS NULL
  `;
  return result === 1;
}
