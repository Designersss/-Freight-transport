import type { DatabaseClient, DatabaseTransaction } from "./index.js";

/** Only trusted server code may select recipients after business authorization. */
export async function appendUserInvalidation(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<bigint> {
  if (!userId.trim()) throw new Error("User ID is required");
  // The per-user row remains locked until commit. A later sequence cannot
  // become visible before an earlier one, even across concurrent writers.
  const stream = await transaction.userEventStream.upsert({
    where: { userId },
    create: { userId, lastSequence: 1n },
    update: { lastSequence: { increment: 1n } },
    select: { lastSequence: true },
  });
  await transaction.userEventInvalidation.create({
    data: { userId, sequence: stream.lastSequence },
  });
  return stream.lastSequence;
}

export async function readUserInvalidations(
  database: DatabaseClient,
  userId: string,
  after: bigint,
): Promise<bigint[]> {
  const events = await database.userEventInvalidation.findMany({
    where: { userId, sequence: { gt: after } },
    orderBy: { sequence: "asc" },
    take: 100,
    select: { sequence: true },
  });
  return events.map(({ sequence }) => sequence);
}

export async function getUserEventHead(
  database: DatabaseClient,
  userId: string,
): Promise<bigint> {
  const stream = await database.userEventStream.findUnique({
    where: { userId },
    select: { lastSequence: true },
  });
  return stream?.lastSequence ?? 0n;
}
