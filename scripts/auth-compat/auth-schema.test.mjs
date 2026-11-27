import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import pg from "pg";
import { profileInput } from "../../packages/auth/dist/contracts.js";
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
    const obsolete = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user'
         AND column_name = 'registrationDraft'`,
    );
    assert.equal(obsolete.rowCount, 0);
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
      data: {
        userId,
        firstName: "Test",
        lastName: "Driver",
        role: "DRIVER",
        birthDate: new Date("1998-05-15T00:00:00.000Z"),
      },
    });
    assert.equal(driver.birthDate.toISOString(), "1998-05-15T00:00:00.000Z");
    assert.equal(driver.status, "ACTIVE");
    await assert.rejects(
      pool.query(
        "UPDATE user_profiles SET birth_date = NULL WHERE user_id = $1",
        [userId],
      ),
      dbCode("23502"),
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
        "INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date) VALUES ($1, 'Test', 'Owner', 'COMPANY_OWNER', '1996-02-29')",
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
        birthDate: new Date("2000-02-29T00:00:00.000Z"),
      },
    });
    assert.equal(
      dispatcher.birthDate.toISOString(),
      "2000-02-29T00:00:00.000Z",
    );
    assert.equal(dispatcher.companyName, null);

    // These are synthetic database keys, not objects uploaded to S3.
    const photoKey = `profile-photos/${randomUUID()}`;
    const setPhoto = (id, key) =>
      pool.query("UPDATE user_profiles SET photo_key = $2 WHERE user_id = $1", [
        id,
        key,
      ]);
    assert.equal(driver.photoKey, null);
    assert.equal(owner.photoKey, null);
    assert.equal(dispatcher.photoKey, null);
    for (const invalid of [
      "",
      "profile-photos/abc",
      `files/${randomUUID()}`,
      `https://example.test/${photoKey}`,
      `../${photoKey}`,
      `${photoKey}/extra`,
      photoKey.toUpperCase(),
      "profile-photos/00000000-0000-0000-0000-000000000000",
    ]) {
      await assert.rejects(setPhoto(dispatcherId, invalid), dbCode("23514"));
    }
    const photoAttempts = await Promise.allSettled([
      setPhoto(userId, photoKey),
      setPhoto(otherId, photoKey),
    ]);
    assert.equal(
      photoAttempts.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    const rejectedPhoto = photoAttempts.find(
      ({ status }) => status === "rejected",
    );
    assert.equal(rejectedPhoto?.reason?.code, "23505");
    const references = await pool.query(
      "SELECT user_id FROM user_profiles WHERE photo_key = $1",
      [photoKey],
    );
    assert.equal(references.rowCount, 1);
    const photoOwner = references.rows[0].user_id;
    const newKey = `profile-photos/${randomUUID()}`;
    await setPhoto(photoOwner, newKey);
    assert.equal(
      (await database.userProfile.findUnique({ where: { userId: photoOwner } }))
        ?.photoKey,
      newKey,
    );
    await setPhoto(photoOwner, null);
    assert.equal(
      (await database.userProfile.findUnique({ where: { userId: photoOwner } }))
        ?.photoKey,
      null,
    );
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
      pool.query(
        "UPDATE user_profiles SET birth_date = '2001-02-29' WHERE user_id = $1",
        [dispatcherId],
      ),
      dbCode("22008"),
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
        "INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date) VALUES ($1, 'Test', 'Orphan', 'DRIVER', '1998-05-15')",
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

  assert.equal(profileInput.safeParse(owner).success, false);
  assert.equal(
    profileInput.safeParse({
      ...owner,
      companyName: "Test Equipment",
    }).success,
    true,
  );
  for (const profile of [dispatcher, driver]) {
    assert.equal(profileInput.safeParse(profile).success, true);
    assert.equal(
      profileInput.safeParse({ ...profile, driverAge: 30 }).success,
      false,
    );
    assert.equal(
      profileInput.safeParse({
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
    assert.equal(profileInput.safeParse(profile).success, false);
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
        profileInput.safeParse({ ...profile, birthDate }).success,
        false,
      );
    }
    const valid = profileInput.safeParse({
      ...profile,
      birthDate: "2000-02-29",
    });
    assert.equal(valid.success, true);
  }
});
