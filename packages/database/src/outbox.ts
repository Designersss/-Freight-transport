import type {
  DatabaseClient,
  DatabaseTransaction,
  OutboxPayload,
} from "./index.js";

export async function appendOutboxEvent(
  transaction: DatabaseTransaction,
  event: { eventType: string; aggregateId: string; payload: OutboxPayload },
): Promise<string> {
  if (!event.eventType.trim() || !event.aggregateId.trim()) {
    throw new Error("Outbox event type and aggregate ID are required");
  }
  const row = await transaction.outboxEvent.create({
    data: event,
    select: { id: true },
  });
  return row.id;
}

/** Publishes pending events atomically. A failed transaction leaves them pending. */
export async function relayOutboxBatch(
  database: DatabaseClient,
  limit = 100,
): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Invalid outbox batch size");
  }

  return database.$transaction(async (transaction) => {
    const events = await transaction.$queryRaw<{ id: string }[]>`
      SELECT id FROM outbox_events
      WHERE processed_at IS NULL
      ORDER BY created_at, id
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    if (events.length === 0) return 0;

    const publishedAt = new Date();
    await transaction.eventPublication.createMany({
      data: events.map(({ id }) => ({ eventId: id, publishedAt })),
      skipDuplicates: true,
    });
    await transaction.outboxEvent.updateMany({
      where: { id: { in: events.map(({ id }) => id) } },
      data: { processedAt: publishedAt, attempts: { increment: 1 } },
    });
    return events.length;
  });
}
