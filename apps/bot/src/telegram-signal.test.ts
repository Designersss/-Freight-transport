import { describe, expect, it, vi } from "vitest";
import { withTelegramSignal } from "./telegram-signal.js";

describe("Telegram abort signal bridge", () => {
  it("propagates cancellation and already aborted signals", async () => {
    const native = new AbortController();
    await withTelegramSignal(native.signal, async (signal) => {
      expect(signal.aborted).toBe(false);
      native.abort();
      expect(signal.aborted).toBe(true);
    });
    await withTelegramSignal(native.signal, async (signal) => {
      expect(signal.aborted).toBe(true);
    });
  });

  it("removes the bridge after successful and failed calls", async () => {
    const native = new AbortController();
    const remove = vi.spyOn(native.signal, "removeEventListener");
    const completed = await withTelegramSignal(
      native.signal,
      async (signal) => signal,
    );
    await expect(
      withTelegramSignal(native.signal, async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(remove).toHaveBeenCalledTimes(2);
    native.abort();
    expect(completed.aborted).toBe(false);
  });
});
