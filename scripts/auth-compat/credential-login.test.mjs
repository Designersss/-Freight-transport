import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import pg from "pg";
import { createAuthOptions } from "../../packages/auth/dist/auth.js";
import { parseAuthConfig } from "../../packages/auth/dist/config.js";

for (const mode of ["change", "reset"]) {
  test(
    `password ${mode} rejects a delayed login with the old password`,
    { timeout: 20_000 },
    async () => {
      const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
      const target = new URL(databaseUrl);
      assert.equal(target.hostname, "127.0.0.1");
      assert.equal(target.pathname, "/freight_auth_compat");
      const pool = new pg.Pool({ connectionString: databaseUrl });
      const origin = "http://127.0.0.1:4000";
      const id = randomUUID();
      const email = `${id}@example.test`;
      const password = randomBytes(24).toString("hex");
      const newPassword = randomBytes(24).toString("hex");
      const reached = Promise.withResolvers();
      const release = Promise.withResolvers();
      let pauseNext = false;
      let pending;
      let resetToken;
      const options = createAuthOptions(
        parseAuthConfig({
          NODE_ENV: "test",
          AUTH_BASE_URL: origin,
          AUTH_WEB_ORIGIN: origin,
          AUTH_SECRET: randomBytes(32).toString("hex"),
          SMTP_HOST: "127.0.0.1",
          SMTP_PORT: "1025",
          SMTP_SECURITY: "local",
          SMTP_FROM: "auth@movaro.test",
        }),
        pool,
        {
          async send(kind, _email, url) {
            assert.equal(kind, "reset-password");
            resetToken = new URL(url).pathname.split("/").at(-1);
          },
        },
      );
      const auth = betterAuth({
        ...options,
        emailAndPassword: {
          ...options.emailAndPassword,
          password: {
            async verify(input) {
              const valid = await verifyPassword(input);
              if (pauseNext) {
                pauseNext = false;
                reached.resolve(valid);
                await release.promise;
              }
              return valid;
            },
          },
        },
      });
      const call = (path, body, cookie) =>
        auth.handler(
          new Request(`${origin}/api/v1/auth${path}`, {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              "x-movaro-client-ip":
                mode === "change" ? "192.0.2.240" : "192.0.2.241",
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify(body),
          }),
        );
      try {
        await pool.query(
          'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, true, $4)',
          [id, "Credential Test", email, `ct_${id.replaceAll("-", "").slice(0, 20)}`],
        );
        await pool.query(
          `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
           VALUES ($1, 'Credential', 'Test', 'DRIVER', '1998-05-15')`,
          [id],
        );
        await pool.query(
          'INSERT INTO "account" (id, "userId", "providerId", "accountId", password) VALUES ($1, $2, $3, $4, $5)',
          [randomUUID(), id, "credential", id, await hashPassword(password)],
        );
        const initial = await call("/sign-in/email", { email, password });
        assert.equal(initial.status, 200);
        const cookie = initial.headers
          .getSetCookie()
          .map((item) => item.split(";")[0])
          .join("; ");
        assert.match(cookie, /session_token=/);
        if (mode === "reset") {
          assert.equal(
            (
              await call("/request-password-reset", {
                email,
                redirectTo: `${origin}/en/reset-password`,
              })
            ).status,
            200,
          );
          assert.ok(resetToken);
        }

        pauseNext = true;
        pending = call("/sign-in/email", { email, password });
        assert.equal(
          await Promise.race([reached.promise, pending.then(() => false)]),
          true,
        );

        const changed =
          mode === "change"
            ? await call(
                "/change-password",
                {
                  currentPassword: password,
                  newPassword,
                  revokeOtherSessions: true,
                },
                cookie,
              )
            : await call("/reset-password", { token: resetToken, newPassword });
        assert.equal(changed.status, 200);
        const before = await pool.query(
          'SELECT id FROM "session" WHERE "userId" = $1 ORDER BY id',
          [id],
        );
        assert.equal(before.rowCount, mode === "change" ? 1 : 0);

        release.resolve();
        const stale = await pending;
        assert.notEqual(stale.status, 200);
        assert.equal(stale.headers.get("set-cookie"), null);
        const after = await pool.query(
          'SELECT id FROM "session" WHERE "userId" = $1 ORDER BY id',
          [id],
        );
        assert.deepEqual(after.rows, before.rows);
        assert.equal(
          (await call("/sign-in/email", { email, password })).status,
          401,
        );
        assert.equal(
          (await call("/sign-in/email", { email, password: newPassword })).status,
          200,
        );
        const revision = await pool.query(
          'SELECT "credentialRevision" FROM "user" WHERE id = $1',
          [id],
        );
        assert.equal(revision.rows[0].credentialRevision, 1);
        const proofs = await pool.query(
          'SELECT "emailLoginProof", "emailLoginRevision" FROM "session" WHERE "userId" = $1',
          [id],
        );
        assert.ok(
          proofs.rows.every(
            (row) => row.emailLoginProof === null && row.emailLoginRevision === null,
          ),
        );
      } finally {
        release.resolve();
        await pending?.catch(() => undefined);
        await pool.end();
      }
    },
  );
}
