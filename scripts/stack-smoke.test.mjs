import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  appendOutboxEvent,
  createDatabaseClient,
} from "../packages/database/dist/index.js";
import {
  PrivateStorage,
  parseStorageConfig,
} from "../packages/storage/dist/index.js";

function startProcess(path, env) {
  const child = spawn(process.execPath, [path], {
    env,
    stdio: "inherit",
  });
  const result = new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, result };
}

async function stopProcess(processHandle) {
  if (!processHandle) return;
  const { child, result } = processHandle;
  child.kill("SIGTERM");
  const exit = await Promise.race([
    result,
    delay(20_000, null, { ref: false }),
  ]);
  if (!exit) {
    child.kill("SIGKILL");
    await result;
    throw new Error("Process did not stop gracefully");
  }
  assert.ok(exit.code === 0 || exit.signal === "SIGTERM");
}

async function eventually(check, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try {
      return await check();
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  } while (Date.now() < deadline);
  throw lastError;
}

async function verifyStack() {
  assert.equal(process.env.STACK_SMOKE, "1");
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/freight_stack_smoke");
  const storageConfig = parseStorageConfig(process.env);
  assert.equal(new URL(storageConfig.S3_ENDPOINT).hostname, "127.0.0.1");

  const database = createDatabaseClient(databaseUrl);
  const storage = new PrivateStorage(storageConfig);
  const aggregateId = randomUUID();
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "4010",
    LOG_LEVEL: "info",
  };
  let api;
  let worker;
  let objectKey;
  const errors = [];
  try {
    await eventually(() => storage.checkReadiness());
    const id = await database.$transaction((tx) =>
      appendOutboxEvent(tx, {
        eventType: "integration.stack",
        aggregateId,
        payload: { verified: true },
      }),
    );
    api = startProcess("apps/api/dist/main.js", env);
    worker = startProcess("apps/worker/dist/main.js", env);
    await eventually(async () => {
      const response = await fetch(
        "http://127.0.0.1:4010/api/v1/health/ready",
        {
          signal: AbortSignal.timeout(3000),
        },
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ready" });
    });
    const bytes = Buffer.from("%PDF-1.7\nStack integration fixture\n%%EOF");
    const uploaded = await storage.put(bytes, "application/pdf");
    objectKey = uploaded.key;
    await eventually(async () => {
      const publication = await database.eventPublication.findUnique({
        where: { eventId: id },
        include: { event: true },
      });
      assert.ok(publication?.event.processedAt);
      assert.equal(publication.event.attempts, 1);
    });
    assert.deepEqual(Buffer.from((await storage.get(objectKey)).bytes), bytes);
    const anonymous = await fetch(
      new URL(
        `/${storageConfig.S3_BUCKET}/${objectKey}`,
        storageConfig.S3_ENDPOINT,
      ),
      { signal: AbortSignal.timeout(5000) },
    );
    await anonymous.body?.cancel();
    assert.ok([401, 403].includes(anonymous.status));
    await stopProcess(worker);
    worker = undefined;
    // A restarted worker must process a new committed event without duplication.
    const nextId = await database.$transaction((tx) =>
      appendOutboxEvent(tx, {
        eventType: "integration.stack.restart",
        aggregateId,
        payload: { verified: true },
      }),
    );
    worker = startProcess("apps/worker/dist/main.js", env);
    await eventually(async () => {
      assert.equal(
        await database.eventPublication.count({
          where: { eventId: { in: [id, nextId] } },
        }),
        2,
      );
    });
    assert.equal(
      (await database.outboxEvent.findUniqueOrThrow({ where: { id } }))
        .attempts,
      1,
    );
    assert.deepEqual(Buffer.from((await storage.get(objectKey)).bytes), bytes);
  } catch (error) {
    errors.push(error);
  }

  const stopped = await Promise.allSettled([
    stopProcess(worker),
    stopProcess(api),
  ]);
  for (const result of stopped) {
    if (result.status === "rejected") errors.push(result.reason);
  }

  try {
    if (objectKey) await storage.delete(objectKey);
  } catch (error) {
    errors.push(error);
  }
  try {
    storage.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    await database.eventPublication.deleteMany({
      where: { event: { aggregateId } },
    });
    await database.outboxEvent.deleteMany({ where: { aggregateId } });
  } catch (error) {
    errors.push(error);
  }
  try {
    await database.$disconnect();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "Infrastructure smoke test failed");
  }
}

test(
  "API, worker, PostgreSQL and private S3 operate together",
  { timeout: 120_000 },
  verifyStack,
);
