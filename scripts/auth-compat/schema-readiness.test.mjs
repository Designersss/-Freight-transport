import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { test } from "node:test";
import pg from "pg";
import { parseApiConfig } from "../../apps/api/dist/config/api-config.js";
import { createApp } from "../../apps/api/dist/create-app.js";
import { parseAuthConfig } from "../../packages/auth/dist/runtime.js";
import { authMigrations } from "../../packages/auth/dist/schema-readiness.js";

test("auth readiness manifest covers the current auth migrations", async () => {
  const entries = await readdir(
    new URL("../../packages/database/prisma/migrations/", import.meta.url),
    { withFileTypes: true },
  );
  const actual = entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name >= "20261126030000_auth_foundation",
    )
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(authMigrations, actual);
});

test("readiness rejects partial auth schema without changing liveness", async () => {
  const databaseUrl = process.env.AUTH_READINESS_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_readiness");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let app;
  let foundation;
  try {
    const config = parseApiConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: databaseUrl,
    });
    app = await createApp(
      config,
      parseAuthConfig({
        NODE_ENV: "test",
        AUTH_BASE_URL: "http://127.0.0.1:4000",
        AUTH_WEB_ORIGIN: "http://127.0.0.1:3000",
        AUTH_SECRET: randomBytes(32).toString("hex"),
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: process.env.AUTH_COMPAT_SMTP_PORT,
        SMTP_SECURITY: "local",
        SMTP_FROM: "auth@movaro.test",
      }),
    );
    foundation = await createApp(config);
    await app.init();
    await foundation.init();
    const get = (instance, path) =>
      instance
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/api/v1/health${path}`,
        });
    const ready = async (instance) => {
      const response = await get(instance, "/ready");
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { status: "ready" });
    };
    const unavailable = async (instance) => {
      const response = await get(instance, "/ready");
      assert.equal(response.statusCode, 503);
      const { error } = response.json();
      assert.equal(error.code, "SERVICE_UNAVAILABLE");
      assert.equal(typeof error.requestId, "string");
      assert.deepEqual(Object.keys(error).sort(), ["code", "requestId"]);
      assert.deepEqual(Object.keys(response.json()), ["error"]);
      const live = await get(instance, "");
      assert.equal(live.statusCode, 200);
      assert.deepEqual(live.json(), { status: "ok" });
    };
    await ready(app);
    await ready(foundation);

    // All DDL is confined to the separate, disposable readiness DB.
    // Restore each mutation before the next scenario, including on failure.
    for (const [remove, restore] of [
      [
        "ALTER TABLE admin_rate_limits RENAME TO readiness_missing_admin_limits",
        "ALTER TABLE readiness_missing_admin_limits RENAME TO admin_rate_limits",
      ],
      [
        "ALTER INDEX admin_rate_limits_key_uidx RENAME TO readiness_missing_admin_limit_index",
        "ALTER INDEX readiness_missing_admin_limit_index RENAME TO admin_rate_limits_key_uidx",
      ],
      [
        "ALTER TABLE registration_email_proofs RENAME TO readiness_missing_proofs",
        "ALTER TABLE readiness_missing_proofs RENAME TO registration_email_proofs",
      ],
      [
        'ALTER TABLE "account" RENAME COLUMN "registrationProofHash" TO readiness_missing_proof',
        'ALTER TABLE "account" RENAME COLUMN readiness_missing_proof TO "registrationProofHash"',
      ],
      [
        'ALTER TABLE "account" DISABLE TRIGGER account_finalize_email_registration',
        'ALTER TABLE "account" ENABLE TRIGGER account_finalize_email_registration',
      ],
      [
        "ALTER INDEX user_username_uidx RENAME TO readiness_missing_username_index",
        "ALTER INDEX readiness_missing_username_index RENAME TO user_username_uidx",
      ],
      [
        "ALTER TABLE telegram_bot_requests RENAME COLUMN registration_draft_id TO readiness_missing_draft_id",
        "ALTER TABLE telegram_bot_requests RENAME COLUMN readiness_missing_draft_id TO registration_draft_id",
      ],
      [
        "ALTER TABLE telegram_bot_requests RENAME CONSTRAINT telegram_bot_requests_registration_recovery_check TO readiness_missing_recovery_check",
        "ALTER TABLE telegram_bot_requests RENAME CONSTRAINT readiness_missing_recovery_check TO telegram_bot_requests_registration_recovery_check",
      ],
      [
        "ALTER TABLE user_profiles RENAME CONSTRAINT user_profiles_birth_date_check TO readiness_missing_birth_check",
        "ALTER TABLE user_profiles RENAME CONSTRAINT readiness_missing_birth_check TO user_profiles_birth_date_check",
      ],
    ]) {
      await pool.query(remove);
      try {
        await unavailable(app);
        await ready(foundation);
      } finally {
        await pool.query(restore);
      }
      await ready(app);
    }
    const migration = authMigrations.at(-1);
    const renamed = "readiness_missing_migration";
    const changed = await pool.query(
      "UPDATE _prisma_migrations SET migration_name = $2 WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL",
      [migration, renamed],
    );
    try {
      assert.equal(changed.rowCount, 1);
      await unavailable(app);
      await ready(foundation);
    } finally {
      await pool.query(
        "UPDATE _prisma_migrations SET migration_name = $2 WHERE migration_name = $1",
        [renamed, migration],
      );
    }
    await ready(app);

    await pool.query(
      "ALTER TABLE user_event_invalidations RENAME TO readiness_missing_events",
    );
    try {
      await unavailable(app);
      await unavailable(foundation);
    } finally {
      await pool.query(
        "ALTER TABLE readiness_missing_events RENAME TO user_event_invalidations",
      );
    }
    await ready(app);
    await ready(foundation);
  } finally {
    try {
      await app?.close();
    } finally {
      try {
        await foundation?.close();
      } finally {
        await pool.end();
      }
    }
  }
});
