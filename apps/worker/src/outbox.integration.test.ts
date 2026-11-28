import { randomBytes, randomUUID } from "node:crypto";
import {
  appendOutboxEvent,
  createDatabaseClient,
  deleteExpiredRegistrationProofs,
  relayOutboxBatch,
} from "@freight/database";
import {
  PrivateStorage,
  parseStorageConfig,
  type StorageConfig,
} from "@freight/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseWorkerConfig, type WorkerConfig } from "./config.js";
import { startWorker } from "./worker.js";

describe("Transactional outbox and pg-boss", () => {
  let config: WorkerConfig;
  let storageConfig: StorageConfig;
  let database: ReturnType<typeof createDatabaseClient>;
  const aggregateId = randomUUID();

  const event = () => ({
    eventType: "integration.test",
    aggregateId,
    payload: { verified: true },
  });

  beforeAll(() => {
    config = parseWorkerConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    });
    storageConfig = parseStorageConfig(process.env);
    database = createDatabaseClient(config.DATABASE_URL);
  });

  afterAll(async () => {
    if (!database) return;
    try {
      await database.eventPublication.deleteMany({
        where: { event: { aggregateId } },
      });
      await database.outboxEvent.deleteMany({ where: { aggregateId } });
    } finally {
      await database.$disconnect();
    }
  });

  it("rolls back outbox writes when the enclosing business transaction fails", async () => {
    const before = await database.outboxEvent.count({ where: { aggregateId } });
    await expect(
      database.$transaction(async (tx) => {
        await appendOutboxEvent(tx, event());
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await database.outboxEvent.count({ where: { aggregateId } })).toBe(
      before,
    );
  });

  it("publishes each event once with concurrent relays and repeated runs", async () => {
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        database.$transaction((tx) => appendOutboxEvent(tx, event())),
      ),
    );
    const counts = await Promise.all([
      relayOutboxBatch(database, 4),
      relayOutboxBatch(database, 4),
    ]);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(8);
    expect(await relayOutboxBatch(database)).toBe(0);
    const publications = await database.eventPublication.findMany({
      where: { eventId: { in: ids } },
      include: { event: true },
    });
    expect(publications).toHaveLength(8);
    expect(
      publications.every(
        (row) => row.event.processedAt !== null && row.event.attempts === 1,
      ),
    ).toBe(true);
  });

  it("processes a committed event via an actual pg-boss job", async () => {
    const id = await database.$transaction((tx) =>
      appendOutboxEvent(tx, event()),
    );
    const worker = await startWorker(config, storageConfig);
    try {
      await vi.waitFor(
        async () => {
          const publication = await database.eventPublication.findUnique({
            where: { eventId: id },
            include: { event: true },
          });
          expect(publication?.event.processedAt).toBeInstanceOf(Date);
        },
        { timeout: 15000, interval: 100 },
      );
      expect(
        await database.eventPublication.count({ where: { eventId: id } }),
      ).toBe(1);
    } finally {
      await worker.stop();
    }
  }, 30000);

  it("cleans expired registration proofs in bounded concurrent batches", async () => {
    const email = `${randomUUID()}@example.test`;
    const hashes = Array.from({ length: 5 }, () =>
      randomBytes(32).toString("hex"),
    );
    const locked = randomBytes(32).toString("hex");
    const valid = randomBytes(32).toString("hex");
    const where = { email };
    try {
      await database.registrationEmailProof.createMany({
        data: [
          ...hashes.map((tokenHash) => ({
            tokenHash,
            email,
            expiresAt: new Date(1),
          })),
          { tokenHash: locked, email, expiresAt: new Date(0) },
          {
            tokenHash: valid,
            email,
            expiresAt: new Date("2099-01-01T00:00:00Z"),
          },
        ],
      });
      for (const limit of [0, -1, 1.5, 1001]) {
        await expect(
          deleteExpiredRegistrationProofs(database, limit),
        ).rejects.toThrow("Invalid registration proof cleanup batch size");
      }

      // Keep one expired proof locked on an independent connection.
      await database.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT token_hash FROM registration_email_proofs
          WHERE token_hash = ${locked}
          FOR UPDATE
        `;
        const counts = await Promise.all([
          deleteExpiredRegistrationProofs(database, 2),
          deleteExpiredRegistrationProofs(database, 2),
        ]);
        expect(counts).toEqual([2, 2]);
        expect(
          await database.registrationEmailProof.count({ where }),
        ).toBe(3);
        expect(
          await tx.registrationEmailProof.findUnique({
            where: { tokenHash: locked },
          }),
        ).not.toBeNull();
      });

      expect(await deleteExpiredRegistrationProofs(database, 2)).toBe(2);
      expect(await deleteExpiredRegistrationProofs(database, 2)).toBe(0);
      const remaining = await database.registrationEmailProof.findMany({
        where,
        select: { tokenHash: true },
      });
      expect(remaining).toEqual([{ tokenHash: valid }]);
    } finally {
      await database.registrationEmailProof.deleteMany({ where });
    }
  });

  it("cleans expired proofs on worker startup and restart without signup", async () => {
    const email = `${randomUUID()}@example.test`;
    const valid = randomBytes(32).toString("hex");
    let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
    try {
      await database.registrationEmailProof.create({
        data: {
          tokenHash: valid,
          email,
          expiresAt: new Date("2099-01-01T00:00:00Z"),
        },
      });
      for (let run = 0; run < 2; run += 1) {
        const expired = randomBytes(32).toString("hex");
        await database.registrationEmailProof.create({
          data: { tokenHash: expired, email, expiresAt: new Date(0) },
        });
        worker = await startWorker(config, storageConfig);
        await vi.waitFor(
          async () => {
            const remaining = await database.registrationEmailProof.findMany({
              where: { email },
              select: { tokenHash: true },
            });
            expect(remaining).toEqual([{ tokenHash: valid }]);
          },
          { timeout: 15000, interval: 100 },
        );
        await worker.stop();
        worker = undefined;
      }
    } finally {
      try {
        await worker?.stop();
      } finally {
        await database.registrationEmailProof.deleteMany({ where: { email } });
      }
    }
  }, 40000);

  it("deletes retired profile photos through the real scheduled worker", async () => {
    const storage = new PrivateStorage(storageConfig);
    const keys: string[] = [];
    let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
    try {
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGPUiKpgIAUwkaR6VMOohiGlAQAvmQEab3goXgAAAABJRU5ErkJggg==",
        "base64",
      );
      const { key } = await storage.putProfilePhoto(png, "image/png");
      keys.push(key);
      const absent = `profile-photos/${randomUUID()}`;
      keys.push(absent);
      await database.profilePhotoCleanup.createMany({
        data: keys.map((key) => ({ key, availableAt: new Date(0) })),
      });
      const scan = await database.profilePhotoScan.findUniqueOrThrow({
        where: { id: 1 },
      });
      worker = await startWorker(
        { ...config, PROFILE_PHOTO_SCAN_ENABLED: true },
        storageConfig,
      );
      await vi.waitFor(
        async () => {
          const inventory = await database.profilePhotoScan.findUniqueOrThrow({
            where: { id: 1 },
          });
          expect(inventory.revision).toBeGreaterThan(scan.revision);
          expect(
            await database.profilePhotoCleanup.count({
              where: { key: { in: keys } },
            }),
          ).toBe(0);
        },
        { timeout: 20000, interval: 100 },
      );
      await expect(storage.getProfilePhoto(key)).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      });
    } finally {
      try {
        await worker?.stop();
      } finally {
        try {
          for (const key of keys) await storage.deleteProfilePhoto(key);
          await database.profilePhotoCleanup.deleteMany({
            where: { key: { in: keys } },
          });
        } finally {
          storage.close();
        }
      }
    }
  }, 40000);
});
