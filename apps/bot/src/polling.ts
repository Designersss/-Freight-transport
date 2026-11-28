import { setTimeout as sleep } from "node:timers/promises";
import {
  TelegramPollError,
  type TelegramTransport,
  type TelegramUpdate,
} from "./telegram.js";

export async function pollTelegram(
  telegram: TelegramTransport,
  handle: (update: TelegramUpdate) => Promise<void>,
  signal: AbortSignal,
  report: (event: "poll-failed" | "update-failed") => void,
): Promise<void> {
  let offset: number | undefined;
  let delay = 1000;
  while (!signal.aborted) {
    let updates: TelegramUpdate[];
    try {
      updates = await telegram.getUpdates(offset, signal);
      delay = 1000;
      // An empty successful response acknowledges the previous offset. Do
      // not keep it across idle periods: Telegram can reset update IDs.
      if (updates.length === 0) offset = undefined;
    } catch (error) {
      if (signal.aborted) break;
      report("poll-failed");
      if (error instanceof TelegramPollError && error.fatal) throw error;
      const retryAfter =
        error instanceof TelegramPollError
          ? (error.retryAfterSeconds ?? 0) * 1000
          : 0;
      await sleep(
        Math.min(2_147_483_647, Math.max(delay, retryAfter)),
        undefined,
        {
          signal,
        },
      ).catch(() => undefined);
      delay = Math.min(delay * 2, 30000);
      continue;
    }
    for (const update of updates.sort((a, b) => a.update_id - b.update_id)) {
      if (signal.aborted) return;
      if (offset !== undefined && update.update_id < offset) continue;
      try {
        await handle(update);
      } catch {
        // Do not automatically replay a possibly committed mutation. The
        // user can recover the authoritative draft with /start.
        report("update-failed");
      }
      offset = update.update_id + 1;
    }
  }
}
