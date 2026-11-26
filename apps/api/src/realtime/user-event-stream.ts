import { setTimeout as delay } from "node:timers/promises";
import {
  type DatabaseClient,
  getUserEventHead,
  readUserInvalidations,
} from "@freight/database";

type SessionResolver = () => Promise<string | null>;

const maxCursor = 9_223_372_036_854_775_807n;

export function parseEventCursor(value: unknown): bigint | null {
  if (value === undefined) return 0n;
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value)
  ) {
    return null;
  }
  const cursor = BigInt(value);
  return cursor <= maxCursor ? cursor : null;
}

type OpenStreamResult =
  | { status: 401 | 400 }
  | { status: 200; stream: AsyncGenerator<string> };

export async function openUserEventStream(
  database: DatabaseClient,
  resolveSession: SessionResolver,
  lastEventId: unknown,
  signal: AbortSignal,
): Promise<OpenStreamResult> {
  const userId = await resolveSession();
  if (!userId) return { status: 401 };
  const cursor = parseEventCursor(lastEventId);
  if (cursor === null || cursor > (await getUserEventHead(database, userId))) {
    return { status: 400 };
  }
  return {
    status: 200,
    stream: streamEvents(database, userId, resolveSession, cursor, signal),
  };
}

async function* streamEvents(
  database: DatabaseClient,
  userId: string,
  resolveSession: SessionResolver,
  cursor: bigint,
  signal: AbortSignal,
): AsyncGenerator<string> {
  let heartbeatAt = Date.now();
  yield "retry: 3000\n\n";
  while (!signal.aborted) {
    // Recheck the actual session on every poll; fail closed on revocation.
    if ((await resolveSession()) !== userId || signal.aborted) return;
    const batch = await readUserInvalidations(database, userId, cursor);
    for (const sequence of batch) {
      if (signal.aborted || (await resolveSession()) !== userId) return;
      cursor = sequence;
      yield `id: ${sequence}\nevent: refresh\ndata: {}\n\n`;
      heartbeatAt = Date.now();
    }
    if (Date.now() - heartbeatAt >= 15_000) {
      yield ": heartbeat\n\n";
      heartbeatAt = Date.now();
    }
    if (batch.length === 100) continue;
    try {
      await delay(1000, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
      return;
    }
  }
}
