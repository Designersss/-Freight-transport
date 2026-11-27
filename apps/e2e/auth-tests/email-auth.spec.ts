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
  const suggestion = await page.request.post("/api/auth/username", {
    headers: { origin: new URL(page.url()).origin },
    data: { action: "suggest", firstName: "Иван", lastName: "Петров" },
  });
  expect(suggestion.status()).toBe(200);
  expect(await suggestion.json()).toEqual({ username: "ivan_petrov" });
  const available = await page.request.post("/api/auth/username", {
    headers: { origin: new URL(page.url()).origin },
    data: { action: "check", username: "IVAN_PETROV" },
  });
  expect(available.status()).toBe(200);
  expect(await available.json()).toEqual({ available: true });
  await page.getByLabel("Электронная почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  const next = page.getByRole("button", { name: "Продолжить", exact: true });
  await next.click();
  await page.getByRole("button", { name: "Водитель", exact: true }).click();
  await page.getByLabel("Имя", { exact: true }).fill("Test");
  await page.getByLabel("Фамилия", { exact: true }).fill("Driver");
  await page.getByLabel("Дата рождения").fill("15.05.1998");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await next.click();
  const initialUsername = page.getByLabel("Username", { exact: true });
  await expect(initialUsername).toHaveValue("test_driver");
  const registeredUsername = `driver_${randomBytes(8).toString("hex")}`;
  await initialUsername.fill(registeredUsername);
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
    "Ваш аккаунт",
  );
  const profile = await page.request.get("/api/auth/profile");
  expect(profile.status()).toBe(200);
  expect(await profile.json()).toEqual({
    firstName: "Test",
    lastName: "Driver",
    role: "DRIVER",
    birthDate: "1998-05-15",
    companyName: null,
  });
  const personal = page.getByRole("region", { name: "Персональные данные" });
  await expect(personal.getByLabel("Имя")).toHaveValue("Test");
  await personal.getByLabel("Имя").fill("Updated");
  await personal.getByLabel("Дата рождения").fill("29.02.1996");
  await personal.getByRole("button", { name: "Сохранить данные" }).click();
  await expect(
    personal.getByText("Персональные данные сохранены."),
  ).toBeVisible();
  await page.reload();
  await expect(personal.getByLabel("Имя")).toHaveValue("Updated");
  await expect(personal.getByLabel("Дата рождения")).toHaveValue("29.02.1996");
  const photoSettings = page.getByRole("region", {
    name: "Фотография профиля",
  });
  const photoInput = photoSettings.locator('input[type="file"]');
  await expect(
    photoSettings.getByRole("button", { name: "Загрузить фото" }),
  ).toBeEnabled();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGPUiKpgIAUwkaR6VMOohiGlAQAvmQEab3goXgAAAABJRU5ErkJggg==",
    "base64",
  );
  await photoInput.setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(photoSettings.getByText("Фотография сохранена.")).toBeVisible();
  await expect(
    photoSettings.getByRole("img", { name: "Фотография профиля" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    photoSettings.getByRole("img", { name: "Фотография профиля" }),
  ).toBeVisible();
  await photoSettings.getByRole("button", { name: "Удалить фото" }).click();
  await photoSettings.getByRole("button", { name: "Подтвердить" }).click();
  await expect(photoSettings.getByText("Фотография удалена.")).toBeVisible();
  await expect(
    photoSettings.getByRole("img", { name: "Без фотографии" }),
  ).toBeVisible();
  const settings = await page.request.get("/api/auth/username/settings");
  expect(settings.status()).toBe(200);
  expect(await settings.json()).toEqual({
    username: registeredUsername,
    nextChangeAt: null,
  });
  const username = `driver_${randomBytes(8).toString("hex")}`;
  const settingsUsername = page.getByLabel("Username", { exact: true });
  await expect(settingsUsername).toHaveValue(registeredUsername);
  await settingsUsername.fill(username);
  const [assigned] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/username/settings" &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Сохранить username" }).click(),
  ]);
  expect(assigned.status()).toBe(200);
  const changed = await assigned.json();
  expect(changed.username).toBe(username);
  expect(Date.parse(changed.nextChangeAt)).toBeGreaterThan(Date.now());
  await expect(page.getByText("Username сохранён.")).toBeVisible();
  await expect(settingsUsername).toHaveValue(username);
  await expect(settingsUsername).toHaveAttribute("readonly", "");
  await page.reload();
  await expect(settingsUsername).toHaveValue(username);
  await expect(settingsUsername).toHaveAttribute("readonly", "");
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

  const secondary = await request.post("/api/auth/sign-in/email", {
    headers: { origin: new URL(page.url()).origin },
    data: { email, password },
  });
  expect(secondary.status()).toBe(200);
  const sessions = page.getByRole("region", { name: "Активные сеансы" });
  await expect(sessions.getByText("Текущий сеанс")).toBeVisible();
  await sessions.getByRole("button", { name: "Обновить список" }).click();
  await expect(sessions.getByRole("listitem")).toHaveCount(2);
  await sessions
    .getByRole("button", { name: "Завершить другие сеансы" })
    .click();
  await sessions.getByRole("button", { name: "Подтвердить" }).click();
  await expect(sessions.getByRole("listitem")).toHaveCount(1);
  const secondaryRevoked = await request.get("/api/auth/get-session");
  expect(secondaryRevoked.status()).toBe(200);
  expect(await secondaryRevoked.json()).toBeNull();

  const newPassword = randomBytes(24).toString("hex");
  await page.getByLabel("Текущий пароль", { exact: true }).fill(password);
  await page.getByLabel("Новый пароль", { exact: true }).fill(newPassword);
  await page.getByLabel("Повторите новый пароль").fill(newPassword);
  await page.getByRole("button", { name: "Изменить пароль" }).click();
  await expect(
    page.getByText("Пароль изменён. Другие сеансы завершены."),
  ).toBeVisible();
  await expect(page.getByLabel("Текущий пароль")).toHaveValue("");
  await expect(page.getByLabel("Новый пароль", { exact: true })).toHaveValue(
    "",
  );
  const previous = await request.get("/api/auth/get-session", {
    headers: { cookie },
  });
  expect(previous.status()).toBe(200);
  expect(await previous.json()).toBeNull();
  const rotated = (await page.context().cookies()).find(({ name }) =>
    name.endsWith("session_token"),
  );
  if (!rotated) throw new Error("Expected rotated session cookie");
  expect(rotated.httpOnly).toBe(true);
  expect(rotated.value).not.toBe(sessionCookie.value);
  await expect(sessions.getByText("Текущий сеанс")).toBeVisible();
  await expect(sessions.getByRole("listitem")).toHaveCount(1);
  const rotatedCookie = `${rotated.name}=${rotated.value}`;
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL("/ru/login");
  const revoked = await request.get("/api/auth/get-session", {
    headers: { cookie: rotatedCookie },
  });
  expect(revoked.status()).toBe(200);
  expect((await revoked.json()) === null).toBe(true);
  await page.goto("/ru/account");
  await expect(page).toHaveURL("/ru/login");
});
