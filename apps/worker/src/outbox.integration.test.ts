import { randomUUID } from "node:crypto";
import {
  appendOutboxEvent,
  createDatabaseClient,
  relayOutboxBatch,
} from "@freight/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseWorkerConfig, type WorkerConfig } from "./config.js";
import { startWorker } from "./worker.js";

describe("Transactional outbox and pg-boss", () => {
  let config: WorkerConfig;
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
    const worker = await startWorker(config);
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
});
