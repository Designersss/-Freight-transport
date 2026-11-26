import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import pg from "pg";
import { createDatabaseClient } from "../../packages/database/dist/index.js";
import { assertAuthSchema } from "./assert-auth-schema.mjs";

test("Prisma auth migration enforces identity and profile integrity", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const database = createDatabaseClient(databaseUrl);
  const userId = randomUUID();
  const otherId = randomUUID();
  const email = `${randomUUID()}@telegram.invalid`;
  const otherEmail = `${randomUUID()}@example.invalid`;
  const providerAccount = randomUUID();
  const dbCode = (code) => (error) => error?.code === code;
  const createUser = (id, address) =>
    pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
      id,
      "Schema test",
      address,
    ]);
  const createAccount = (id, owner) =>
    pool.query(
      'INSERT INTO "account" (id, "providerId", "accountId", "userId") VALUES ($1, $2, $3, $4)',
      [id, "schema-test", providerAccount, owner],
    );
  try {
    const auth = betterAuth({
      baseURL: "http://127.0.0.1:4000",
      secret: randomBytes(32).toString("hex"),
      database: pool,
      rateLimit: { storage: "database" },
    });
    await assertAuthSchema(auth.options);
    await createUser(userId, email);
    await createUser(otherId, otherEmail);
    assert.equal(
      await database.userProfile.findUnique({ where: { userId } }),
      null,
    );
    await assert.rejects(createUser(randomUUID(), email), dbCode("23505"));
    await assert.rejects(
      createUser(randomUUID(), "UPPER@example.invalid"),
      dbCode("23514"),
    );
    await assert.rejects(
      pool.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [
        userId,
      ]),
      dbCode("23514"),
    );

    const attempts = await Promise.allSettled([
      createAccount(randomUUID(), userId),
      createAccount(randomUUID(), otherId),
    ]);
    assert.equal(
      attempts.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    const rejected = attempts.find(({ status }) => status === "rejected");
    assert.equal(rejected?.reason?.code, "23505");

    const driver = await database.userProfile.create({
      data: { userId, firstName: "Test", lastName: "Driver", role: "DRIVER" },
    });
    assert.equal(driver.driverAge, null);
    assert.equal(driver.status, "ACTIVE");
    await assert.rejects(
      pool.query("UPDATE user_profiles SET driver_age = 0 WHERE user_id = $1", [
        userId,
      ]),
      dbCode("23514"),
    );
    await assert.rejects(
      pool.query(
        "UPDATE user_profiles SET first_name = ' ' WHERE user_id = $1",
        [userId],
      ),
      dbCode("23514"),
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO user_profiles (user_id, first_name, last_name, role, driver_age) VALUES ($1, 'Test', 'Owner', 'COMPANY_OWNER', 30)",
        [otherId],
      ),
      dbCode("23514"),
    );
    await database.userProfile.create({
      data: {
        userId: otherId,
        firstName: "Test",
        lastName: "Owner",
        role: "COMPANY_OWNER",
      },
    });
    await assert.rejects(
      pool.query('DELETE FROM "user" WHERE id = $1', [userId]),
      dbCode("23503"),
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO user_profiles (user_id, first_name, last_name, role) VALUES ($1, 'Test', 'Orphan', 'DRIVER')",
        [randomUUID()],
      ),
      dbCode("23503"),
    );
  } finally {
    await database.$disconnect();
    await pool.end();
  }
});
