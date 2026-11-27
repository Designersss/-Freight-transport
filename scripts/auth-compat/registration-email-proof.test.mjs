import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  issueRegistrationEmailProof,
  readRegistrationEmailProof,
} from "../../packages/auth/dist/registration-email-proof.js";
import { registrationEmailProofHash } from "../../packages/auth/dist/registration-email-token.js";

test("registration proof expires and can be consumed only once", async () => {
  const url = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: url.href });
  const email = `${randomBytes(12).toString("hex")}@example.test`;
  const consume = (client, hash, address = email) =>
    client.query(
      "SELECT consume_registration_email_proof($1, $2) AS consumed",
      [hash, address],
    );
  try {
    const first = await issueRegistrationEmailProof(pool, email.toUpperCase());
    const second = await issueRegistrationEmailProof(pool, email);
    const firstHash = registrationEmailProofHash(first);
    const secondHash = registrationEmailProofHash(second);
    assert.notEqual(first, second);
    assert.equal(await readRegistrationEmailProof(pool, first), email);
    assert.equal(await readRegistrationEmailProof(pool, first), email);
    assert.equal(await readRegistrationEmailProof(pool, second), email);
    assert.equal(await readRegistrationEmailProof(pool, "invalid"), null);
    const records = await pool.query(
      "SELECT token_hash FROM registration_email_proofs WHERE email = $1",
      [email],
    );
    assert.deepEqual(
      new Set(records.rows.map((row) => row.token_hash)),
      new Set([firstHash, secondHash]),
    );
    const users = await pool.query('SELECT id FROM "user" WHERE email = $1', [
      email,
    ]);
    assert.equal(users.rowCount, 0);
    const wrong = await consume(pool, firstHash, "other@example.test");
    assert.equal(wrong.rows[0].consumed, false);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const used = await consume(client, firstHash);
      assert.equal(used.rows[0].consumed, true);
      // A failure in a future account-creation transaction restores the proof.
    } finally {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    assert.equal(await readRegistrationEmailProof(pool, first), email);
    const race = await Promise.all([
      consume(pool, firstHash),
      consume(pool, firstHash),
    ]);
    assert.deepEqual(
      race.map((r) => r.rows[0].consumed).sort(),
      [false, true],
    );
    assert.equal(await readRegistrationEmailProof(pool, first), null);
    assert.equal(await readRegistrationEmailProof(pool, second), email);

    await pool.query(
      "UPDATE registration_email_proofs SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [secondHash],
    );
    assert.equal(await readRegistrationEmailProof(pool, second), null);
    const expired = await consume(pool, secondHash);
    assert.equal(expired.rows[0].consumed, false);
    await issueRegistrationEmailProof(pool, email);
    const removed = await pool.query(
      "SELECT token_hash FROM registration_email_proofs WHERE token_hash = $1",
      [secondHash],
    );
    assert.equal(removed.rowCount, 0);
  } finally {
    try {
      await pool.query(
        "DELETE FROM registration_email_proofs WHERE email = $1",
        [email],
      );
    } finally {
      await pool.end();
    }
  }
});
