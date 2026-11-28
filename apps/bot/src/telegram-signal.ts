import {
  AbortController as TelegramAbortController,
  type AbortSignal as TelegramAbortSignal,
} from "abort-controller";

// grammY uses abort-controller rather than the native Node.js AbortSignal.
export async function withTelegramSignal<T>(
  signal: AbortSignal,
  run: (signal: TelegramAbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new TelegramAbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  try {
    return await run(controller.signal);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
