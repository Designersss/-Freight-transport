import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  createRegistrationEmailToken,
  registrationEmailProofHash,
} from "./registration-email-token.ts";

describe("registration email token", () => {
  it("uses 32 random bytes and stores only the SHA-256 digest", () => {
    const { token, hash } = createRegistrationEmailToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(token, "base64url").length, 32);
    assert.equal(hash, createHash("sha256").update(token).digest("hex"));
    assert.equal(registrationEmailProofHash(token), hash);
    assert.notEqual(createRegistrationEmailToken().token, token);
  });

  it("rejects malformed or non-string proof material", () => {
    for (const token of [
      null,
      undefined,
      {},
      "",
      "a".repeat(42),
      "a".repeat(44),
      `${"a".repeat(42)}+`,
    ])
      assert.equal(registrationEmailProofHash(token), null);
  });
});
