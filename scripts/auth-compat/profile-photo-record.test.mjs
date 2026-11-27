import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  changeProfilePhoto,
  readProfilePhotoKey,
  reserveProfilePhotoKey,
} from "../../packages/auth/dist/profile-photo-record.js";
import {
  claimProfilePhotoCleanup,
  completeProfilePhotoCleanup,
  createDatabaseClient,
  deferProfilePhotoCleanup,
  recordProfilePhotoInventory,
} from "../../packages/database/dist/index.js";

test("profile photo reservations, replacement and durable cleanup", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const database = createDatabaseClient(databaseUrl);

  async function createAccount() {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)',
      [userId, "Photo test", `${userId}@example.test`],
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, 'Photo', 'Test', 'DRIVER', '1996-02-29')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO "session" (id, "userId", token, "expiresAt")
       VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')`,
      [sessionId, userId, randomUUID()],
    );
    return { userId, sessionId };
  }

  try {
    const owner = await createAccount();
    const other = await createAccount();
    const invalid = { ...owner, sessionId: other.sessionId };
    assert.equal(await readProfilePhotoKey(pool, invalid), undefined);
    assert.equal(await reserveProfilePhotoKey(pool, invalid), null);
    assert.equal(await readProfilePhotoKey(pool, owner), null);

    const first = await reserveProfilePhotoKey(pool, owner);
    assert.ok(first);
    assert.equal(
      await changeProfilePhoto(pool, other, first),
      "reservation-expired",
    );
    assert.equal(await changeProfilePhoto(pool, owner, first), "updated");
    assert.equal(await readProfilePhotoKey(pool, owner), first);
    assert.equal(await readProfilePhotoKey(pool, other), null);
    assert.equal(await database.profilePhotoCleanup.count(), 0);

    const second = await reserveProfilePhotoKey(pool, owner);
    const third = await reserveProfilePhotoKey(pool, owner);
    assert.ok(second);
    assert.ok(third);
    assert.deepEqual(
      await Promise.all([
        changeProfilePhoto(pool, owner, second),
        changeProfilePhoto(pool, owner, third),
      ]),
      ["updated", "updated"],
    );
    const current = await readProfilePhotoKey(pool, owner);
    assert.ok(current === second || current === third);
    const retired = current === second ? third : second;
    const queued = await database.profilePhotoCleanup.findMany();
    assert.deepEqual(
      queued.map(({ key }) => key).sort(),
      [first, retired].sort(),
    );
    assert.ok(queued.every(({ ownerId }) => ownerId === null));
    assert.equal(
      await changeProfilePhoto(pool, owner, first),
      "reservation-expired",
    );

    const scan = await database.profilePhotoScan.findUniqueOrThrow({
      where: { id: 1 },
    });
    const pending = await reserveProfilePhotoKey(pool, other);
    assert.ok(pending);
    const orphan = `profile-photos/${randomUUID()}`;
    const recent = `profile-photos/${randomUUID()}`;
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const inventory = [
      { key: current, lastModified: old },
      { key: first, lastModified: old },
      { key: pending, lastModified: old },
      { key: orphan, lastModified: old },
      { key: recent, lastModified: new Date() },
      { key: `files/${randomUUID()}`, lastModified: old },
    ];
    const advances = await Promise.all([
      recordProfilePhotoInventory(database, scan.revision, "next", inventory),
      recordProfilePhotoInventory(database, scan.revision, "next", inventory),
    ]);
    assert.ok(advances.includes(1));
    assert.ok(advances.includes(null));
    const updatedScan = await database.profilePhotoScan.findUniqueOrThrow({
      where: { id: 1 },
    });
    assert.equal(updatedScan.revision, scan.revision + 1);
    assert.equal(updatedScan.continuationToken, "next");
    assert.equal(await database.profilePhotoCleanup.count(), 4);
    assert.equal(
      await recordProfilePhotoInventory(
        database,
        updatedScan.revision,
        null,
        inventory,
      ),
      0,
    );
    assert.equal(
      (await database.profilePhotoCleanup.findUnique({
        where: { key: pending },
      }))?.ownerId,
      other.userId,
    );
    await database.profilePhotoCleanup.deleteMany({
      where: { key: { in: [orphan, pending] } },
    });

    const abandoned = await reserveProfilePhotoKey(pool, owner);
    assert.ok(abandoned);
    await database.profilePhotoCleanup.update({
      where: { key: abandoned },
      data: { availableAt: new Date(0) },
    });
    assert.equal(
      await changeProfilePhoto(pool, owner, abandoned),
      "reservation-expired",
    );
    const groups = await Promise.all([
      claimProfilePhotoCleanup(database, 2),
      claimProfilePhotoCleanup(database, 2),
    ]);
    const claims = groups.flat();
    assert.deepEqual(
      claims.map(({ key }) => key).sort(),
      [first, retired, abandoned].sort(),
    );
    assert.equal(new Set(claims.map(({ key }) => key)).size, 3);
    const [retry, ...done] = claims;
    assert.ok(retry);
    assert.equal(await deferProfilePhotoCleanup(database, retry), true);
    for (const claim of done) {
      assert.equal(await completeProfilePhotoCleanup(database, claim), true);
    }
    assert.deepEqual(await claimProfilePhotoCleanup(database, 2), []);
    await database.profilePhotoCleanup.update({
      where: { key: retry.key },
      data: { availableAt: new Date(0) },
    });
    const [reclaimed] = await claimProfilePhotoCleanup(database, 1);
    assert.ok(reclaimed);
    assert.equal(reclaimed.key, retry.key);
    assert.equal(reclaimed.attempts, retry.attempts + 1);
    assert.equal(await completeProfilePhotoCleanup(database, retry), false);
    assert.equal(await completeProfilePhotoCleanup(database, reclaimed), true);

    await pool.query('DELETE FROM "session" WHERE id = $1', [owner.sessionId]);
    assert.equal(await readProfilePhotoKey(pool, owner), undefined);
    assert.equal(await changeProfilePhoto(pool, owner, null), "forbidden");
    const replacementSession = randomUUID();
    await pool.query(
      `INSERT INTO "session" (id, "userId", token, "expiresAt")
       VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')`,
      [replacementSession, owner.userId, randomUUID()],
    );
    const restored = { userId: owner.userId, sessionId: replacementSession };
    assert.equal(await readProfilePhotoKey(pool, restored), current);
    assert.equal(await changeProfilePhoto(pool, restored, null), "updated");
    assert.equal(await changeProfilePhoto(pool, restored, null), "updated");
    assert.equal(await readProfilePhotoKey(pool, restored), null);
    const [removed] = await claimProfilePhotoCleanup(database, 1);
    assert.ok(removed);
    assert.equal(removed.key, current);
    assert.equal(await completeProfilePhotoCleanup(database, removed), true);
    assert.equal(await database.profilePhotoCleanup.count(), 0);
  } finally {
    await database.$disconnect();
    await pool.end();
  }
});
