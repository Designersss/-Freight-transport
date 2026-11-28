import type { TelegramCleanup } from "@freight/auth/telegram-cleanup";
import type { PgBoss } from "pg-boss";
import type { Logger } from "pino";

const QUEUE = "telegram-auth-cleanup";

export async function registerTelegramCleanup(
  boss: PgBoss,
  cleanup: TelegramCleanup,
  logger: Logger,
): Promise<void> {
  await boss.createQueue(QUEUE, {
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 120,
  });
  await boss.work(QUEUE, { pollingIntervalSeconds: 1 }, async () => {
    const deleted = await cleanup.run();
    logger.debug({ deleted }, "Telegram auth cleanup completed");
  });
  await boss.schedule(QUEUE, "* * * * *", {});
  await boss.send(QUEUE, {});
}
