import {
  type DatabaseClient,
  recordProfilePhotoInventory,
} from "@freight/database";
import type { PrivateStorage } from "@freight/storage";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";

const QUEUE = "profile-photo-scan";

export async function registerProfilePhotoScan(
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
    const state = await database.profilePhotoScan.findUniqueOrThrow({
      where: { id: 1 },
    });
    const page = await storage.listProfilePhotos(state.continuationToken);
    const queued = await recordProfilePhotoInventory(
      database,
      state.revision,
      page.nextToken,
      page.objects,
    );
    logger.debug(
      { scanned: page.objects.length, queued },
      "Profile photo inventory completed",
    );
  });
  await boss.schedule(QUEUE, "* * * * *", {});
  await boss.send(QUEUE, {});
}
