import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import pg from "pg";
import { createAuthOptions } from "../../packages/auth/dist/auth.js";
import { parseAuthConfig } from "../../packages/auth/dist/config.js";

const modes = ["change", "reset", "change-race", "reset-race"];

for (const mode of modes) {
  test(
    `credential rotation rejects stale ${mode} operations`,
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
      let pauseVerify = false;
      let pauseHash = false;
      let pending;
      const resetTokens = [];
      let requestNumber = 0;
      const change = mode === "change" || mode === "change-race";
      const otherPassword = randomBytes(24).toString("hex");
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
            resetTokens.push(new URL(url).pathname.split("/").at(-1));
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
              if (pauseVerify) {
                pauseVerify = false;
                reached.resolve(valid);
                await release.promise;
              }
              return valid;
            },
            async hash(input) {
              const hash = await hashPassword(input);
              if (pauseHash) {
                pauseHash = false;
                reached.resolve(true);
                await release.promise;
              }
              return hash;
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
              "x-movaro-client-ip": `198.51.100.${modes.indexOf(mode) * 20 + ++requestNumber}`,
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
        // Issue a link even for password-change cases: rotation must invalidate
        // earlier recovery links regardless of which operation wins.
        const requestReset = () =>
          call("/request-password-reset", {
            email,
            redirectTo: `${origin}/en/reset-password`,
          });
        assert.equal((await requestReset()).status, 200);
        assert.equal((await requestReset()).status, 200);
        const [firstToken, secondToken] = resetTokens;
        assert.ok(firstToken && secondToken && firstToken !== secondToken);

        if (mode === "change-race") {
          pauseVerify = true;
          pending = call(
            "/change-password",
            {
              currentPassword: password,
              newPassword: otherPassword,
              revokeOtherSessions: true,
            },
            cookie,
          );
        } else if (mode === "reset-race") {
          pauseHash = true;
          pending = call("/reset-password", {
            token: firstToken,
            newPassword: otherPassword,
          });
        } else {
          pauseVerify = true;
          pending = call("/sign-in/email", { email, password });
        }
        assert.equal(
          await Promise.race([reached.promise, pending.then(() => false)]),
          true,
        );

        const changed =
          change
            ? await call(
                "/change-password",
                {
                  currentPassword: password,
                  newPassword,
                  revokeOtherSessions: true,
                },
                cookie,
              )
            : await call("/reset-password", {
                token: secondToken,
                newPassword,
              });
        assert.equal(changed.status, 200);
        const before = await pool.query(
          'SELECT id FROM "session" WHERE "userId" = $1 ORDER BY id',
          [id],
        );
        assert.equal(before.rowCount, change ? 1 : 0);

        release.resolve();
        const stale = await pending;
        assert.notEqual(stale.status, 200);
        assert.equal(stale.headers.get("set-cookie"), null);
        const after = await pool.query(
          'SELECT id FROM "session" WHERE "userId" = $1 ORDER BY id',
          [id],
        );
        assert.deepEqual(after.rows, before.rows);
        for (const token of [firstToken, secondToken]) {
          const invalid = await call("/reset-password", {
            token,
            newPassword: otherPassword,
          });
          assert.equal(invalid.status, 400);
        }
        assert.equal(
          (await call("/sign-in/email", { email, password })).status,
          401,
        );
        assert.equal(
          (await call("/sign-in/email", { email, password: otherPassword }))
            .status,
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
        const account = await pool.query(
          'SELECT "rotationUserId", "rotationEmail", "rotationRevision" FROM "account" WHERE "userId" = $1',
          [id],
        );
        assert.deepEqual(account.rows, [
          {
            rotationUserId: null,
            rotationEmail: null,
            rotationRevision: null,
          },
        ]);
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
