import {
  type DatabaseClient,
  deleteExpiredRegistrationProofs,
} from "@freight/database";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";

const QUEUE = "registration-proof-cleanup";
const BATCH_SIZE = 100;
const MAX_BATCHES = 10;

export async function registerRegistrationProofCleanup(
  boss: PgBoss,
  database: DatabaseClient,
  logger: Logger,
): Promise<void> {
  await boss.createQueue(QUEUE, {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
  });
  await boss.work(QUEUE, { pollingIntervalSeconds: 1 }, async () => {
    let deleted = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const count = await deleteExpiredRegistrationProofs(database, BATCH_SIZE);
      deleted += count;
      if (count < BATCH_SIZE) break;
    }
    logger.debug({ deleted }, "Registration proof cleanup completed");
  });
  await boss.schedule(QUEUE, "* * * * *", {});
  await boss.send(QUEUE, {});
}
