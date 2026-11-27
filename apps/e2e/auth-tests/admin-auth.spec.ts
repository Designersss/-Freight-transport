import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test("administrator uses the isolated admin application and can sign out", async ({
  page,
  request,
}) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const database = process.env.AUTH_BROWSER_DATABASE_URL;
  if (!database) throw new Error("Isolated browser database required");
  const origin = "http://127.0.0.1:3111";
  const email = `admin-${randomBytes(8).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("hex");
  execFileSync("node", ["packages/auth/dist/admin-cli.js"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: database },
    input: JSON.stringify({
      email,
      password,
      firstName: "Test",
      lastName: "Administrator",
      birthDate: "1998-05-15",
    }),
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 15_000,
  });
  await page.goto(`${origin}/ru`);
  await expect(page).toHaveURL(`${origin}/ru/login`);
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/ru`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Администрирование",
  );
  await expect(page.getByText("Test Administrator")).toBeVisible();
  await expect(page.getByText("Глобальный администратор")).toBeVisible();
  const cookies = await page.context().cookies(origin);
  const admin = cookies.find((cookie) =>
    cookie.name.endsWith("movaro-admin.session_token"),
  );
  expect(admin?.httpOnly).toBe(true);
  if (!admin) throw new Error("Expected admin session");
  const header = `${admin.name}=${admin.value}`;
  const publicSession = await request.get(
    "http://127.0.0.1:3110/api/auth/get-session",
    { headers: { cookie: header } },
  );
  expect(await publicSession.json()).toBeNull();
  await page.reload();
  await expect(page.getByText("Test Administrator")).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/ru/login`);
  const revoked = await request.get(`${origin}/api/auth/get-session`, {
    headers: { cookie: header },
  });
  expect(await revoked.json()).toBeNull();
  await page.goto(`${origin}/ru`);
  await expect(page).toHaveURL(`${origin}/ru/login`);
});
