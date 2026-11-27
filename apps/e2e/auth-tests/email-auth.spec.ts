import { randomBytes } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function verificationLink(request: APIRequestContext, email: string) {
  const port = Number(process.env.AUTH_BROWSER_MAILPIT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid isolated Mailpit port");
  const origin = `http://127.0.0.1:${port}`;
  const found: { url?: URL } = {};
  await expect
    .poll(async () => {
      const response = await request.get(`${origin}/api/v1/messages`);
      expect(response.status()).toBe(200);
      const data: unknown = await response.json();
      if (!isRecord(data) || !Array.isArray(data.messages))
        throw new Error("Invalid Mailpit message list");
      const messages: unknown[] = data.messages;
      for (const message of messages) {
        if (
          !isRecord(message) ||
          typeof message.ID !== "string" ||
          !Array.isArray(message.To)
        )
          continue;
        const recipients: unknown[] = message.To;
        if (
          !recipients.some(
            (recipient) => isRecord(recipient) && recipient.Address === email,
          )
        )
          continue;
        const detail = await request.get(
          `${origin}/api/v1/message/${encodeURIComponent(message.ID)}`,
        );
        expect(detail.status()).toBe(200);
        const body: unknown = await detail.json();
        if (!isRecord(body) || typeof body.Text !== "string")
          throw new Error("Invalid Mailpit message body");
        const link = body.Text.match(/https?:\/\/[^\s]+/)?.[0];
        if (!link) continue;
        const url = new URL(link);
        if (
          url.origin !== "http://127.0.0.1:4110" ||
          url.pathname !== "/api/v1/auth/verify-email" ||
          url.username ||
          url.password ||
          !url.searchParams.get("token") ||
          url.searchParams.get("callbackURL") !==
            "http://127.0.0.1:3110/ru/email-confirmation"
        )
          throw new Error("Unexpected verification link");
        found.url = url;
        return true;
      }
      return false;
    })
    .toBe(true);
  if (!found.url) throw new Error("Verification message not received");
  return found.url;
}

test("real signup, email verification, login and session revocation", async ({
  page,
  request,
}) => {
  const email = `${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("hex");

  await page.goto("/ru/signup");
  await page.getByLabel("Имя", { exact: true }).fill("Test User");
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  const [signup] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Создать аккаунт" }).click(),
  ]);
  expect(signup.status()).toBe(200);
  await expect(page).toHaveURL("/ru/email-confirmation");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Подтверждение почты",
  );
  const initialSession = await page.request.get("/api/auth/get-session");
  expect(initialSession.status()).toBe(200);
  expect((await initialSession.json()) === null).toBe(true);

  await page.getByRole("link", { name: "Вернуться ко входу" }).click();
  await expect(page).toHaveURL("/ru/login");
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  const [unverified] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/sign-in/email" &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Войти", exact: true }).click(),
  ]);
  expect(unverified.status()).toBe(403);
  expect(await unverified.json()).toEqual({ code: "EMAIL_NOT_VERIFIED" });
  await expect(page).toHaveURL("/ru/email-confirmation");
  const blockedSession = await page.request.get("/api/auth/get-session");
  expect(blockedSession.status()).toBe(200);
  expect((await blockedSession.json()) === null).toBe(true);

  const link = await verificationLink(request, email);
  try {
    await page.goto(link.href);
  } catch {
    throw new Error("Verification navigation failed");
  }
  expect(new URL(page.url()).pathname).toBe("/ru/login");
  expect(new URL(page.url()).searchParams.get("verified")).toBe("done");
  await expect(page.getByRole("main").getByRole("status")).toHaveText(
    "Почта подтверждена. Теперь вы можете войти.",
  );
  const verifiedSession = await page.request.get("/api/auth/get-session");
  expect(verifiedSession.status()).toBe(200);
  expect((await verifiedSession.json()) === null).toBe(true);

  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL("/ru/account");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Завершите регистрацию",
  );
  await page.getByLabel("Имя", { exact: true }).fill("Test");
  await page.getByLabel("Фамилия", { exact: true }).fill("Driver");
  await page.getByRole("button", { name: "Водитель", exact: true }).click();
  await expect(page.getByLabel("Возраст (необязательно)")).toBeVisible();
  await page.getByRole("button", { name: "Завершить регистрацию" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ваш аккаунт",
  );
  const profile = await page.request.get("/api/auth/profile");
  expect(profile.status()).toBe(200);
  expect(await profile.json()).toEqual({
    firstName: "Test",
    lastName: "Driver",
    role: "DRIVER",
    driverAge: null,
    companyName: null,
  });
  await page.reload();
  await expect(page.getByRole("main").getByText("Водитель")).toBeVisible();
  await expect(
    page.getByRole("main").getByText(email, { exact: true }),
  ).toBeVisible();
  const active = await page.request.get("/api/auth/get-session");
  expect(active.status()).toBe(200);
  expect(await active.json()).toMatchObject({
    user: { email, emailVerified: true },
  });
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(({ name }) =>
    name.endsWith("session_token"),
  );
  if (!sessionCookie) throw new Error("Expected session cookie");
  expect(sessionCookie.httpOnly).toBe(true);
  const cookie = `${sessionCookie.name}=${sessionCookie.value}`;
  const replay = await request.get("/api/auth/get-session", {
    headers: { cookie },
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toMatchObject({
    user: { email, emailVerified: true },
  });

  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL("/ru/login");
  const revoked = await request.get("/api/auth/get-session", {
    headers: { cookie },
  });
  expect(revoked.status()).toBe(200);
  expect((await revoked.json()) === null).toBe(true);
  await page.goto("/ru/account");
  await expect(page).toHaveURL("/ru/login");
});
