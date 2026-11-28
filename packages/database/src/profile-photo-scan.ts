import type { DatabaseClient } from "./index.js";

export interface ProfilePhotoInventoryEntry {
  key: string;
  lastModified: Date;
}

// Reconciliation never deletes from storage directly. The cursor and
// candidates commit together; concurrent workers cannot regress the cursor.
export async function recordProfilePhotoInventory(
  database: DatabaseClient,
  revision: number,
  nextToken: string | null,
  objects: ProfilePhotoInventoryEntry[],
): Promise<number | null> {
  if (objects.length > 100) throw new Error("Invalid photo inventory size");
  return database.$transaction(async (tx) => {
    const advanced = await tx.profilePhotoScan.updateMany({
      where: { id: 1, revision },
      data: { revision: { increment: 1 }, continuationToken: nextToken },
    });
    if (advanced.count !== 1) return null;
    return tx.$executeRaw`
      INSERT INTO profile_photo_cleanup (key, available_at)
      SELECT DISTINCT candidate.key, clock_timestamp()
      FROM jsonb_to_recordset(${JSON.stringify(objects)}::jsonb)
        AS candidate(key text, "lastModified" timestamptz)
      WHERE candidate."lastModified" < clock_timestamp() - interval '1 hour'
        AND candidate.key ~ '^profile-photos/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND NOT EXISTS (
          SELECT 1 FROM user_profiles p WHERE p.photo_key = candidate.key
        )
      ON CONFLICT (key) DO NOTHING
    `;
  });
}
