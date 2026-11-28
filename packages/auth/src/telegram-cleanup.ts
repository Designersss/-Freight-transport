import { Pool } from "pg";
import { deleteExpiredTelegramBotRequests } from "./telegram-bot-requests.js";
import {
  deleteExpiredTelegramRegistrationCompletions,
  deleteExpiredTelegramRegistrationDrafts,
} from "./telegram-registration-draft.js";

const MAX_BATCHES = 10;
const BATCH_SIZE = 500;

// The worker reuses the same bounded cleanup operations as the auth tests.
export function createTelegramCleanup(databaseUrl: string) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  return {
    async run(): Promise<number> {
      let deleted = 0;
      for (const cleanup of [
        deleteExpiredTelegramBotRequests,
        deleteExpiredTelegramRegistrationDrafts,
        deleteExpiredTelegramRegistrationCompletions,
      ]) {
        for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
          const count = await cleanup(pool);
          deleted += count;
          if (count < BATCH_SIZE) break;
        }
      }
      return deleted;
    },
    close: () => pool.end(),
  };
}

export type TelegramCleanup = ReturnType<typeof createTelegramCleanup>;
