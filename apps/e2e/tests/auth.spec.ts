import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

test("login form validates locally and supports both languages and themes", async ({
  page,
}) => {
  await page.goto("/ru");
  await page.getByRole("link", { name: "Вход", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Войдите в MOVARO",
  );
  await expect(
    page.getByRole("link", { name: "Подтверждение почты", exact: true }),
  ).toHaveCount(0);
  let requests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/auth/"))
      requests++;
  });
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Введите корректный email.")).toBeVisible();
  await expect(page.getByText("Проверьте длину пароля.")).toBeVisible();
  await expect(page.getByLabel("Пароль")).toHaveAttribute("maxlength", "128");
  await page.getByLabel("Электронная почта").fill("user@example.test");
  await page.getByLabel("Пароль").fill("12345");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Проверьте длину пароля.")).toBeVisible();
  expect(requests).toBe(0);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveTitle("MOVARO");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Светлая тема" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Sign in to MOVARO",
  );
  await expect(page).toHaveURL(/\/en\/login$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("MOVARO");
  await expectAccessible(page);
});

test("registration, recovery and invalid reset link are navigable", async ({
  page,
}) => {
  await page.goto("/en/signup");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Create an account",
  );
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Reset your password",
  );
  await page.goto("/en/reset-password");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "The link is invalid or expired. Request a new one.",
  );
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});

test("login preserves email and clears password after invalid credentials", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({ status: 401, json: { code: "INVALID_CREDENTIALS" } }),
  );
  await page.goto("/ru/login");
  const email = page.getByLabel("Электронная почта");
  const password = page.getByLabel("Пароль", { exact: true });
  const submit = page.getByRole("button", { name: "Войти", exact: true });
  await email.fill("user@example.test");
  await password.fill("test-password");
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Неверная электронная почта или пароль.",
  );
  await expect(email).toHaveValue("user@example.test");
  await expect(password).toHaveValue("");
  await expect(submit).toBeEnabled();
  await expect(page).toHaveURL(/\/ru\/login$/);
  await expect(page).toHaveTitle("MOVARO");
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});

test("registration wizard preserves profile after conflict and network failure", async ({
  page,
}) => {
  await page.route("**/api/auth/username", (route) => {
    const data = route.request().postDataJSON();
    return route.fulfill({
      json:
        data.action === "suggest"
          ? { username: "test_user" }
          : { available: true },
    });
  });
  let attempts = 0;
  await page.route("**/api/auth/sign-up/email", async (route) => {
    attempts++;
    const data = route.request().postDataJSON();
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("image");
    expect(Object.keys(data.registration).sort()).toEqual([
      "profile",
      "username",
    ]);
    expect(data.registration.profile).toEqual({
      firstName: "Test",
      lastName: "User",
      role: "COMPANY_OWNER",
      birthDate: "1998-05-15",
      companyName: "Test Company",
    });
    if (attempts === 1) {
      expect(data.registration.username).toBe("test_user");
      await route.fulfill({
        status: 409,
        json: { code: "USERNAME_TAKEN" },
      });
    } else {
      expect(data.registration.username).toBe("test_user2");
      await route.abort();
    }
  });
  await page.goto("/en/signup");
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const email = page.getByLabel("Email address");
  const password = page.getByLabel("Password", { exact: true });
  const next = page.getByRole("button", { name: "Continue", exact: true });
  const back = page.getByRole("button", { name: "Back", exact: true });
  const heading = page.getByRole("heading", { level: 1 });
  await email.fill("user@example.test");
  await password.fill("test-password");
  await next.click();
  await expect(heading).toHaveText("Choose your role");
  await expect(heading).toBeFocused();
  await page.getByRole("button", { name: "Driver", exact: true }).click();
  await expect(heading).toHaveText("Complete your profile");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const first = page.getByLabel("First name", { exact: true });
  const last = page.getByLabel("Last name", { exact: true });
  await first.fill("Test");
  await last.fill("User");
  await page.getByLabel("Date of birth").fill("05/15/1998");
  await expect(page.getByLabel("Company name")).toHaveCount(0);
  await back.click();
  await page.getByRole("button", { name: "Dispatcher", exact: true }).click();
  await expect(first).toHaveValue("Test");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByLabel("Company name")).toHaveCount(0);
  await back.click();
  await page
    .getByRole("button", { name: "Company owner", exact: true })
    .click();
  await expect(last).toHaveValue("User");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByLabel("Date of birth")).toHaveValue("05/15/1998");
  await page.getByLabel("Company name").fill("Test Company");
  await next.click();
  await expect(heading).toHaveText("Choose a username");
  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toHaveValue("test_user");
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
  const submit = page.getByRole("button", { name: "Create account" });
  await submit.click();
  await expect(page.locator("#username-error")).toHaveText(
    "This name is already taken.",
  );
  await expect(username).toHaveValue("test_user");
  await username.fill("test_user2");
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Authentication is unavailable. Try again later.",
  );
  await expect(heading).toHaveText("Create an account");
  await expect(email).toHaveValue("user@example.test");
  await expect(password).toHaveValue("");
  await password.fill("test-password");
  await next.click();
  await page
    .getByRole("button", { name: "Company owner", exact: true })
    .click();
  await expect(first).toHaveValue("Test");
  await expect(last).toHaveValue("User");
  await expect(page.getByLabel("Company name")).toHaveValue("Test Company");
  await next.click();
  await expect(username).toHaveValue("test_user2");
  expect(attempts).toBe(2);
  await expect(page).toHaveURL(/\/en\/signup$/);
  await expect(page).toHaveTitle("MOVARO");
});

for (const language of [
  {
    locale: "ru",
    email: "Электронная почта",
    password: "Пароль",
    submit: "Войти",
    confirmation: "Подтверждение почты",
  },
  {
    locale: "en",
    email: "Email address",
    password: "Password",
    submit: "Sign in",
    confirmation: "Confirm your email",
  },
]) {
  test(`unverified login preserves ${language.locale} locale`, async ({
    page,
  }) => {
    await page.route("**/api/auth/sign-in/email", (route) =>
      route.fulfill({ status: 403, json: { code: "EMAIL_NOT_VERIFIED" } }),
    );
    await page.goto(`/${language.locale}/login`);
    await page.getByLabel(language.email).fill("user@example.test");
    await page
      .getByLabel(language.password, { exact: true })
      .fill("test-password");
    await page
      .getByRole("button", { name: language.submit, exact: true })
      .click();
    await expect(page).toHaveURL(`/${language.locale}/email-confirmation`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      language.confirmation,
    );
    await expect(page.locator("html")).toHaveAttribute("lang", language.locale);
  });
}

for (const variant of [
  {
    locale: "ru",
    theme: "dark",
    title: "Завершите регистрацию",
    firstName: "Имя",
    lastName: "Фамилия",
    driver: "Водитель",
    birthDate: "Дата рождения",
    typedDate: "15.05.1998",
    pickedDate: "16.05.1998",
    invalidDate: "31.04.1998",
    openCalendar: "Открыть календарь",
    month: "Месяц",
    year: "Год",
    invalidBirthDate: "Введите корректную дату рождения.",
    submit: "Завершить регистрацию",
    invalidRole: "Выберите роль.",
  },
  {
    locale: "en",
    theme: "light",
    title: "Complete your registration",
    firstName: "First name",
    lastName: "Last name",
    driver: "Driver",
    birthDate: "Date of birth",
    typedDate: "05/15/1998",
    pickedDate: "05/16/1998",
    invalidDate: "04/31/1998",
    openCalendar: "Open calendar",
    month: "Month",
    year: "Year",
    invalidBirthDate: "Enter a valid date of birth.",
    submit: "Complete registration",
    invalidRole: "Choose a role.",
  },
]) {
  test(`profile onboarding validates and preserves input: ${variant.locale}/${variant.theme}`, async ({
    page,
  }) => {
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        json: {
          user: {
            id: "test-user",
            name: "Test User",
            email: "user@example.test",
            emailVerified: true,
          },
          session: { expiresAt: "2099-01-01T00:00:00Z" },
        },
      }),
    );
    let posts = 0;
    await page.route("**/api/auth/profile", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: null });
      }
      posts++;
      expect(route.request().postDataJSON().birthDate).toBe("1998-05-16");
      return route.fulfill({
        status: 503,
        json: { code: "AUTH_REQUEST_FAILED" },
      });
    });
    await page.goto(`/${variant.locale}/account`);
    if (variant.theme === "light")
      await page.getByRole("button", { name: "Light theme" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      variant.theme,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      variant.title,
    );
    const first = page.getByLabel(variant.firstName, { exact: true });
    const last = page.getByLabel(variant.lastName, { exact: true });
    const submit = page.getByRole("button", { name: variant.submit });
    await first.fill("Test");
    await last.fill("Driver");
    await submit.click();
    await expect(
      page.getByText(variant.invalidRole, { exact: true }),
    ).toBeVisible();
    expect(posts).toBe(0);
    const driver = page.getByRole("button", {
      name: variant.driver,
      exact: true,
    });
    await driver.click();
    await expect(driver).toHaveAttribute("aria-pressed", "true");
    const birthDate = page.getByLabel(variant.birthDate);
    await expect(birthDate).toBeVisible();
    await submit.click();
    await expect(
      page.getByText(variant.invalidBirthDate, { exact: true }),
    ).toBeVisible();
    expect(posts).toBe(0);
    await birthDate.fill(variant.typedDate);
    const trigger = page.getByRole("button", { name: variant.openCalendar });
    await trigger.click();
    const calendar = page.getByRole("dialog", { name: variant.openCalendar });
    await expect(
      calendar.getByRole("combobox", { name: variant.month, exact: true }),
    ).toHaveValue("4");
    await expect(
      calendar.getByRole("combobox", { name: variant.year, exact: true }),
    ).toHaveValue("1998");
    await expect(calendar.locator('[aria-selected="true"] button')).toHaveText(
      "15",
    );
    await page.keyboard.press("Escape");
    await expect(calendar).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await birthDate.fill(variant.invalidDate);
    await submit.click();
    await expect(
      page.getByText(variant.invalidBirthDate, { exact: true }),
    ).toBeVisible();
    await expect(birthDate).toHaveValue(variant.invalidDate);
    expect(posts).toBe(0);
    await birthDate.fill(variant.typedDate);
    await trigger.click();
    await calendar
      .getByRole("button", { name: /16 мая 1998|May 16, 1998/ })
      .click();
    await expect(calendar).toHaveCount(0);
    await expect(birthDate).toHaveValue(variant.pickedDate);
    await submit.click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(submit).toBeEnabled();
    expect(posts).toBe(1);
    await expect(first).toHaveValue("Test");
    await expect(last).toHaveValue("Driver");
    await expect(birthDate).toHaveValue(variant.pickedDate);
    await expect(driver).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveTitle("MOVARO");
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });
}

test("username settings handle validation, conflicts and server cooldown", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "test-user",
          name: "Test Driver",
          email: "user@example.test",
          emailVerified: true,
        },
        session: { expiresAt: "2099-01-01T00:00:00Z" },
      },
    }),
  );
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({
      json: {
        firstName: "Test",
        lastName: "Driver",
        role: "DRIVER",
        birthDate: "1998-05-15",
        companyName: null,
      },
    }),
  );
  await page.route("**/api/auth/profile/photo", (route) =>
    route.fulfill({ status: 404, json: { code: "NOT_FOUND" } }),
  );
  let posts = 0;
  let current: { username: string; nextChangeAt: string | null } = {
    username: "test_driver",
    nextChangeAt: null,
  };
  await page.route("**/api/auth/username/settings", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: current });
    posts++;
    const data = route.request().postDataJSON();
    if (posts === 1) {
      expect(data).toEqual({ username: "occupied" });
      return route.fulfill({
        status: 409,
        json: { code: "USERNAME_TAKEN" },
      });
    }
    expect(data).toEqual({ username: "new_driver" });
    current = {
      username: "new_driver",
      nextChangeAt: "2099-01-07T12:00:00Z",
    };
    return route.fulfill({ json: current });
  });
  const currentSession = {
    id: "current-session",
    current: true,
    createdAt: "2026-01-01T12:00:00Z",
    expiresAt: "2099-01-01T12:00:00Z",
    userAgent: "Current browser",
  };
  const otherSession = {
    ...currentSession,
    id: "other-session",
    current: false,
    userAgent: "Other browser",
  };
  let activeSessions = [currentSession, otherSession];
  let revocations = 0;
  await page.route("**/api/auth/sessions", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { sessions: activeSessions, hasMore: false },
      });
    revocations++;
    expect(route.request().postDataJSON()).toEqual({
      action: "revoke",
      id: "other-session",
    });
    activeSessions = [currentSession];
    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/en/account");
  await page.getByRole("button", { name: "Light theme" }).click();
  const username = page.getByLabel("Username", { exact: true });
  const save = page.getByRole("button", { name: "Save username" });
  await expect(username).toHaveValue("test_driver");
  await expect(save).toBeDisabled();
  await username.fill("@invalid");
  await save.click();
  await expect(page.getByText("Enter a valid username.")).toBeVisible();
  expect(posts).toBe(0);
  await username.fill("occupied");
  await save.click();
  await expect(page.getByText("This name is already taken.")).toBeVisible();
  await expect(username).toHaveValue("occupied");
  await username.fill("NEW_DRIVER");
  await save.click();
  await expect(page.getByText("Username saved.")).toBeVisible();
  await expect(username).toHaveValue("new_driver");
  await expect(username).toHaveAttribute("readonly", "");
  await expect(save).toHaveCount(0);
  await expect(
    page.getByText("Next change available:", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check change availability" }).click();
  await expect(username).toHaveValue("new_driver");
  await expect(username).toHaveAttribute("readonly", "");
  expect(posts).toBe(2);
  await expect(
    page.getByText("Current session", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Other browser")).toBeVisible();
  const endSession = page.getByRole("button", {
    name: "End session",
    exact: true,
  });
  await endSession.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(revocations).toBe(0);
  await endSession.click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Sessions updated.")).toBeVisible();
  await expect(page.getByText("Other browser")).toHaveCount(0);
  expect(revocations).toBe(1);
  let passwordPosts = 0;
  await page.route("**/api/auth/change-password", (route) => {
    passwordPosts++;
    expect(route.request().postDataJSON()).toEqual({
      currentPassword: "old-password",
      newPassword: "new-password",
    });
    return passwordPosts === 1
      ? route.fulfill({
          status: 400,
          json: { code: "INVALID_CURRENT_PASSWORD" },
        })
      : route.fulfill({ json: { success: true } });
  });
  const oldPassword = page.getByLabel("Current password", { exact: true });
  const newPassword = page.getByLabel("New password", { exact: true });
  const confirmation = page.getByLabel("Confirm new password");
  const changePassword = page.getByRole("button", { name: "Change password" });
  await oldPassword.fill("old-password");
  await newPassword.fill("new-password");
  await confirmation.fill("mismatch");
  await changePassword.click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  expect(passwordPosts).toBe(0);
  await confirmation.fill("new-password");
  await changePassword.click();
  await expect(page.getByText("Incorrect current password.")).toBeVisible();
  await expect(oldPassword).toHaveValue("");
  await expect(newPassword).toHaveValue("");
  await expect(confirmation).toHaveValue("");
  await oldPassword.fill("old-password");
  await newPassword.fill("new-password");
  await confirmation.fill("new-password");
  await changePassword.click();
  await expect(
    page.getByText("Password changed. Other sessions ended."),
  ).toBeVisible();
  await expect(oldPassword).toHaveValue("");
  expect(passwordPosts).toBe(2);
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
});

for (const variant of [
  {
    locale: "ru",
    theme: "dark",
    title: "Фотография профиля",
    empty: "Без фотографии",
    upload: "Загрузить фото",
    replace: "Заменить фото",
    remove: "Удалить фото",
    invalid: "Выберите корректное изображение JPEG или PNG до 2 МБ.",
    saved: "Фотография сохранена.",
    removed: "Фотография удалена.",
    cancel: "Отмена",
    confirm: "Подтвердить",
  },
  {
    locale: "en",
    theme: "light",
    title: "Profile photo",
    empty: "No photo",
    upload: "Upload photo",
    replace: "Replace photo",
    remove: "Remove photo",
    invalid: "Choose a valid JPEG or PNG image up to 2 MB.",
    saved: "Photo saved.",
    removed: "Photo removed.",
    cancel: "Cancel",
    confirm: "Confirm",
  },
]) {
  test(`profile photo settings: ${variant.locale}/${variant.theme}`, async ({
    page,
  }) => {
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        json: {
          user: {
            id: "photo-user",
            name: "Test Driver",
            email: "photo@example.test",
            emailVerified: true,
          },
          session: { expiresAt: "2099-01-01T00:00:00Z" },
        },
      }),
    );
    await page.route("**/api/auth/profile", (route) =>
      route.fulfill({
        json: {
          firstName: "Test",
          lastName: "Driver",
          role: "DRIVER",
          birthDate: "1998-05-15",
          companyName: null,
        },
      }),
    );
    await page.route("**/api/auth/username/settings", (route) =>
      route.fulfill({ json: { username: "test_driver", nextChangeAt: null } }),
    );
    await page.route("**/api/auth/sessions", (route) =>
      route.fulfill({ json: { sessions: [], hasMore: false } }),
    );
    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIABQa//2Q==",
      "base64",
    );
    let present = false;
    let writes = 0;
    await page.route("**/api/auth/profile/photo", (route) => {
      const method = route.request().method();
      if (method === "GET") {
        return present
          ? route.fulfill({ contentType: "image/jpeg", body: jpeg })
          : route.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
      }
      writes++;
      if (method === "POST") {
        expect(route.request().headers()["content-type"]).toBe("image/jpeg");
        expect(route.request().postDataBuffer()).toEqual(jpeg);
        present = true;
      } else {
        expect(method).toBe("DELETE");
        present = false;
      }
      return route.fulfill({ json: { success: true } });
    });
    await page.goto(`/${variant.locale}/account`);
    if (variant.theme === "light")
      await page.getByRole("button", { name: "Light theme" }).click();
    const settings = page.getByRole("region", { name: variant.title });
    await expect(settings.getByRole("img", { name: variant.empty })).toBeVisible();
    const input = settings.locator('input[type="file"]');
    await expect(settings.getByRole("button", { name: variant.upload })).toBeEnabled();
    await input.setInputFiles({
      name: "wrong.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("invalid"),
    });
    await expect(settings.getByRole("alert")).toHaveText(variant.invalid);
    expect(writes).toBe(0);
    const file = { name: "photo.jpg", mimeType: "image/jpeg", buffer: jpeg };
    await input.setInputFiles(file);
    await expect(settings.getByRole("status")).toHaveText(variant.saved);
    await expect(settings.getByRole("img", { name: variant.title })).toBeVisible();
    await expect(settings.getByRole("button", { name: variant.replace })).toBeEnabled();
    await input.setInputFiles(file);
    await expect.poll(() => writes).toBe(2);
    const remove = settings.getByRole("button", { name: variant.remove });
    await remove.click();
    await settings.getByRole("button", { name: variant.cancel }).click();
    expect(writes).toBe(2);
    await remove.click();
    await settings.getByRole("button", { name: variant.confirm }).click();
    await expect(settings.getByRole("status")).toHaveText(variant.removed);
    await expect(settings.getByRole("img", { name: variant.empty })).toBeVisible();
    expect(writes).toBe(3);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });
}
