import {
  claimProfilePhotoCleanup,
  completeProfilePhotoCleanup,
  type DatabaseClient,
  deferProfilePhotoCleanup,
} from "@freight/database";
import type { PrivateStorage } from "@freight/storage";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";

const QUEUE = "profile-photo-cleanup";
const BATCH_SIZE = 4;

export async function registerProfilePhotoCleanup(
  boss: PgBoss,
  database: DatabaseClient,
  storage: PrivateStorage,
  logger: Logger,
): Promise<void> {
  await boss.createQueue(QUEUE, {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
  });
  await boss.work(QUEUE, { pollingIntervalSeconds: 1 }, async () => {
    const claims = await claimProfilePhotoCleanup(database, BATCH_SIZE);
    let deleted = 0;
    let failed = 0;
    for (const claim of claims) {
      try {
        await storage.deleteProfilePhoto(claim.key);
      } catch {
        await deferProfilePhotoCleanup(database, claim);
        failed += 1;
        continue;
      }
      if (await completeProfilePhotoCleanup(database, claim)) deleted += 1;
    }
    if (failed > 0) {
      logger.warn({ failed }, "Profile photo cleanup deferred");
    }
    logger.debug({ deleted, failed }, "Profile photo cleanup completed");
  });
  await boss.schedule(QUEUE, "* * * * *", {});
  await boss.send(QUEUE, {});
}
