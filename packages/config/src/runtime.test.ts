import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRuntimeMode } from "./runtime.ts";

test("accepts the three supported runtime modes", () => {
  for (const mode of ["development", "test", "production"] as const) {
    assert.equal(parseRuntimeMode(mode), mode);
  }
});

test("rejects missing and invalid runtime modes", () => {
  for (const value of [undefined, null, "", "staging", "Production", 42]) {
    assert.throws(() => parseRuntimeMode(value), /NODE_ENV must be/);
  }
});
