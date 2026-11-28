import { setTimeout as sleep } from "node:timers/promises";
import type { TelegramTransport, TelegramUpdate } from "./telegram.js";

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
    } catch {
      if (signal.aborted) break;
      report("poll-failed");
      await sleep(delay, undefined, { signal }).catch(() => undefined);
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
