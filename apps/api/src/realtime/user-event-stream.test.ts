import { describe, expect, it } from "vitest";
import { parseEventCursor } from "./user-event-stream.js";

describe("SSE cursor", () => {
  it.each([undefined, "0", "1", "9223372036854775807"])(
    "accepts valid cursor %s",
    (value) => {
      expect(parseEventCursor(value)).toBe(BigInt(value ?? "0"));
    },
  );

  it.each([
    "",
    "-1",
    "01",
    "1.5",
    "1e2",
    " 1",
    "1\n",
    "9223372036854775808",
    ["1"],
    1,
  ])("rejects malformed or out-of-range cursor %s", (value) => {
    expect(parseEventCursor(value)).toBeNull();
  });
});
