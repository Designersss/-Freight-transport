import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import pg from "pg";
import {
  registrationDraftInput,
  registrationProfileInput,
} from "../../packages/auth/dist/contracts.js";
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
  const dispatcherId = randomUUID();
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
    await createUser(dispatcherId, `${randomUUID()}@example.test`);
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
    assert.equal(driver.birthDate, null);
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
    const owner = await database.userProfile.create({
      data: {
        userId: otherId,
        firstName: "Test",
        lastName: "Owner",
        role: "COMPANY_OWNER",
        companyName: "Test Equipment",
        birthDate: new Date("1996-02-29T00:00:00.000Z"),
      },
    });
    assert.equal(owner.companyName, "Test Equipment");
    assert.equal(owner.birthDate.toISOString(), "1996-02-29T00:00:00.000Z");
    await assert.rejects(
      pool.query(
        "UPDATE user_profiles SET birth_date = '9999-12-31' WHERE user_id = $1",
        [otherId],
      ),
      dbCode("23514"),
    );
    const dispatcher = await database.userProfile.create({
      data: {
        userId: dispatcherId,
        firstName: "Test",
        lastName: "Dispatcher",
        role: "DISPATCHER",
        driverAge: 30,
      },
    });
    assert.equal(dispatcher.driverAge, 30);
    assert.equal(dispatcher.birthDate, null);
    assert.equal(dispatcher.companyName, null);
    await assert.rejects(
      pool.query(
        "UPDATE user_profiles SET company_name = ' ' WHERE user_id = $1",
        [otherId],
      ),
      dbCode("23514"),
    );
    await assert.rejects(
      pool.query(
        "UPDATE user_profiles SET company_name = 'Other company' WHERE user_id = $1",
        [dispatcherId],
      ),
      dbCode("23514"),
    );
    await assert.rejects(
      pool.query("UPDATE user_profiles SET driver_age = 0 WHERE user_id = $1", [
        dispatcherId,
      ]),
      dbCode("23514"),
    );
    await assert.rejects(
      pool.query(
        "UPDATE user_profiles SET company_name = $2 WHERE user_id = $1",
        [otherId, "a".repeat(201)],
      ),
      dbCode("23514"),
    );
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

test("new registration requires role-specific profile data", () => {
  const identity = {
    firstName: "Test",
    lastName: "User",
    birthDate: "1996-02-29",
  };
  const owner = { ...identity, role: "COMPANY_OWNER" };
  const dispatcher = { ...identity, role: "DISPATCHER" };
  const driver = { ...identity, role: "DRIVER" };

  assert.equal(registrationProfileInput.safeParse(owner).success, false);
  assert.equal(
    registrationProfileInput.safeParse({
      ...owner,
      companyName: "Test Equipment",
    }).success,
    true,
  );
  for (const profile of [dispatcher, driver]) {
    assert.equal(registrationProfileInput.safeParse(profile).success, true);
    assert.equal(
      registrationProfileInput.safeParse({ ...profile, driverAge: 30 }).success,
      false,
    );
    assert.equal(
      registrationProfileInput.safeParse({ ...profile, driverAge: -1 }).success,
      false,
    );
    assert.equal(
      registrationProfileInput.safeParse({
        ...profile,
        companyName: "Test Equipment",
      }).success,
      false,
    );
  }
});

test("birth date is required for every new registration role", () => {
  const identity = { firstName: "Test", lastName: "User" };
  for (const role of ["COMPANY_OWNER", "DISPATCHER", "DRIVER"]) {
    const profile = {
      ...identity,
      role,
      ...(role === "COMPANY_OWNER" ? { companyName: "Test Equipment" } : {}),
    };
    assert.equal(registrationProfileInput.safeParse(profile).success, false);
    assert.equal(registrationDraftInput.safeParse(profile).success, true);
    for (const birthDate of [
      "",
      "1999-02-29",
      "2000-04-31",
      "29.02.1996",
      "0000-01-01",
      "9999-12-31",
      "1996-02-29T00:00:00Z",
    ]) {
      assert.equal(
        registrationProfileInput.safeParse({ ...profile, birthDate }).success,
        false,
      );
    }
    const valid = registrationProfileInput.safeParse({
      ...profile,
      birthDate: "2000-02-29",
    });
    assert.equal(valid.success, true);
  }
});
