import { createTelegramCleanup } from "@freight/auth/telegram-cleanup";
import { createDatabaseClient, relayOutboxBatch } from "@freight/database";
import { PrivateStorage, type StorageConfig } from "@freight/storage";
import { PgBoss } from "pg-boss";
import { pino } from "pino";
import type { WorkerConfig } from "./config.js";
import { registerProfilePhotoCleanup } from "./profile-photo-cleanup.js";
import { registerProfilePhotoScan } from "./profile-photo-scan.js";
import { registerRegistrationProofCleanup } from "./registration-proof-cleanup.js";
import { registerTelegramCleanup } from "./telegram-cleanup.js";

export const OUTBOX_QUEUE = "outbox-relay";
const MAX_BATCHES_PER_JOB = 10;

export async function startWorker(
  config: WorkerConfig,
  storageConfig: StorageConfig,
): Promise<{ stop(): Promise<void> }> {
  const logger = pino({ level: config.LOG_LEVEL });
  const database = createDatabaseClient(config.DATABASE_URL);
  const boss = new PgBoss(config.DATABASE_URL);
  const storage = new PrivateStorage(storageConfig);
  const telegramCleanup = createTelegramCleanup(config.DATABASE_URL);

  boss.on("error", (error: Error) => {
    logger.error({ errorName: error.name }, "Queue runtime error");
  });

  let stopping: Promise<void> | undefined;
  function stop(): Promise<void> {
    stopping ??= (async () => {
      try {
        await boss.stop();
      } finally {
        try {
          await telegramCleanup.close();
        } finally {
          try {
            storage.close();
          } finally {
            await database.$disconnect();
          }
        }
      }
    })();
    return stopping;
  }

  try {
    // Fail startup if application migrations are absent.
    await database.eventPublication.findFirst({ select: { eventId: true } });
    await database.profilePhotoCleanup.findFirst({ select: { key: true } });
    await database.profilePhotoScan.findUniqueOrThrow({ where: { id: 1 } });
    await database.registrationEmailProof.findFirst({
      select: { tokenHash: true, expiresAt: true },
    });
    await database.telegramBotRequest.findFirst({ select: { id: true } });
    await database.telegramRegistrationDraft.findFirst({
      select: { id: true },
    });
    await database.telegramRegistrationCompletion.findFirst({
      select: { id: true },
    });
    await storage.checkReadiness();
    await boss.start();
    await boss.createQueue(OUTBOX_QUEUE, {
      retryLimit: 5,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 120,
    });
    await boss.work(OUTBOX_QUEUE, { pollingIntervalSeconds: 1 }, async () => {
      let published = 0;
      for (let batch = 0; batch < MAX_BATCHES_PER_JOB; batch += 1) {
        const count = await relayOutboxBatch(
          database,
          config.OUTBOX_BATCH_SIZE,
        );
        published += count;
        if (count < config.OUTBOX_BATCH_SIZE) break;
      }
      logger.debug({ published }, "Outbox relay completed");
    });
    // A missed tick cannot lose events: pending rows remain in PostgreSQL.
    await boss.schedule(OUTBOX_QUEUE, "* * * * *", {});
    await boss.send(OUTBOX_QUEUE, {});
    await registerRegistrationProofCleanup(boss, database, logger);
    await registerTelegramCleanup(boss, telegramCleanup, logger);
    await registerProfilePhotoCleanup(boss, database, storage, logger);
    if (config.PROFILE_PHOTO_SCAN_ENABLED) {
      await registerProfilePhotoScan(boss, database, storage, logger);
    }
    logger.info("Worker started");
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
