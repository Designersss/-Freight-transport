import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/telegram/settings", (route) =>
    route.fulfill({
      json: {
        linked: false,
        canLink: false,
        requiresFreshSession: false,
      },
    }),
  );
});

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
  const token = "a".repeat(43);
  await page.route("**/api/auth/registration/email/start", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "user@example.test",
      locale: "en",
    });
    return route.fulfill({ json: { success: true } });
  });
  await page.route("**/api/auth/registration/email/read", (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    return route.fulfill({ json: { email: "user@example.test" } });
  });
  await page.route("**/api/auth/registration/email/complete", async (route) => {
    attempts++;
    const data = route.request().postDataJSON();
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("image");
    expect(data).not.toHaveProperty("email");
    expect(data.token).toBe(token);
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
  await expect(password).toHaveCount(0);
  await next.click();
  await expect(heading).toHaveText("Confirm your email");
  await page.goto("/en/login");
  await page.goto(`/en/signup#token=${token}`);
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(heading).toHaveText("Choose a password");
  await expect(email).toHaveValue("user@example.test");
  await expect(email).not.toBeEditable();
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
  await expect(heading).toHaveText("Choose a username");
  await expect(username).toHaveValue("test_user2");
  await back.click();
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
    error: "Неверная электронная почта или пароль.",
  },
  {
    locale: "en",
    email: "Email address",
    password: "Password",
    submit: "Sign in",
    error: "Incorrect email or password.",
  },
]) {
  test(`unregistered login preserves ${language.locale} locale`, async ({
    page,
  }) => {
    await page.route("**/api/auth/sign-in/email", (route) =>
      route.fulfill({ status: 401, json: { code: "INVALID_CREDENTIALS" } }),
    );
    await page.goto(`/${language.locale}/login`);
    await page.getByLabel(language.email).fill("user@example.test");
    await page
      .getByLabel(language.password, { exact: true })
      .fill("test-password");
    await page
      .getByRole("button", { name: language.submit, exact: true })
      .click();
    await expect(page).toHaveURL(`/${language.locale}/login`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      language.error,
    );
    await expect(
      page.getByLabel(language.password, { exact: true }),
    ).toHaveValue("");
    await expect(page.locator("html")).toHaveAttribute("lang", language.locale);
  });
}

for (const variant of [
  {
    locale: "ru",
    theme: "dark",
    title: "Персональные данные",
    firstName: "Имя",
    lastName: "Фамилия",
    birthDate: "Дата рождения",
    typedDate: "15.05.1998",
    pickedDate: "16.05.1998",
    invalidDate: "31.04.1998",
    openCalendar: "Открыть календарь",
    month: "Месяц",
    year: "Год",
    invalidBirthDate: "Введите корректную дату рождения.",
    submit: "Сохранить данные",
  },
  {
    locale: "en",
    theme: "light",
    title: "Personal details",
    firstName: "First name",
    lastName: "Last name",
    birthDate: "Date of birth",
    typedDate: "05/15/1998",
    pickedDate: "05/16/1998",
    invalidDate: "04/31/1998",
    openCalendar: "Open calendar",
    month: "Month",
    year: "Year",
    invalidBirthDate: "Enter a valid date of birth.",
    submit: "Save details",
  },
]) {
  test(`profile settings validate and preserve input: ${variant.locale}/${variant.theme}`, async ({
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
      expect(route.request().method()).toBe("GET");
      return route.fulfill({
        json: {
          firstName: "Test",
          lastName: "Driver",
          role: "DRIVER",
          birthDate: "1998-05-15",
          companyName: null,
        },
      });
    });
    await page.route("**/api/auth/profile/photo", (route) =>
      route.fulfill({ status: 404, json: { code: "NOT_FOUND" } }),
    );
    await page.route("**/api/auth/username/settings", (route) =>
      route.fulfill({ json: { username: "test_driver", nextChangeAt: null } }),
    );
    await page.route("**/api/auth/sessions", (route) =>
      route.fulfill({ json: { sessions: [], hasMore: false } }),
    );
    await page.route("**/api/auth/telegram/settings", (route) =>
      route.fulfill({ status: 404, json: { code: "NOT_FOUND" } }),
    );
    await page.route("**/api/auth/profile/settings", (route) => {
      posts++;
      expect(route.request().postDataJSON()).toEqual({
        firstName: "Updated",
        lastName: "Driver",
        birthDate: "1998-05-16",
      });
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
    const settings = page.getByRole("region", { name: variant.title });
    await expect(settings).toBeVisible();
    const first = settings.getByLabel(variant.firstName, { exact: true });
    const last = settings.getByLabel(variant.lastName, { exact: true });
    const submit = settings.getByRole("button", { name: variant.submit });
    await expect(submit).toBeDisabled();
    await first.fill("Updated");
    const birthDate = settings.getByLabel(variant.birthDate);
    await birthDate.fill("");
    await submit.click();
    await expect(
      settings.getByText(variant.invalidBirthDate, { exact: true }),
    ).toBeVisible();
    expect(posts).toBe(0);
    await birthDate.fill(variant.typedDate);
    const trigger = settings.getByRole("button", {
      name: variant.openCalendar,
    });
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
    await expect(settings.getByRole("alert")).toBeVisible();
    await expect(submit).toBeEnabled();
    expect(posts).toBe(1);
    await expect(first).toHaveValue("Updated");
    await expect(last).toHaveValue("Driver");
    await expect(birthDate).toHaveValue(variant.pickedDate);
    await expect(page).toHaveTitle("MOVARO");
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });
}

test("missing email profile never opens obsolete onboarding", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "incomplete-email",
          name: "Test User",
          email: "user@example.test",
          emailVerified: true,
        },
        session: { expiresAt: "2099-01-01T00:00:00Z" },
      },
    }),
  );
  for (const status of [403, 200]) {
    await page.route("**/api/auth/profile", (route) => {
      expect(route.request().method()).toBe("GET");
      return route.fulfill({
        status,
        json: status === 403 ? { code: "AUTH_REQUEST_FAILED" } : null,
      });
    });
    await page.goto("/en/account");
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("First name")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Driver", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
    await page.unroute("**/api/auth/profile");
  }
});

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
  let profileWrites = 0;
  await page.route("**/api/auth/profile/settings", (route) => {
    profileWrites++;
    expect(route.request().postDataJSON()).toEqual({
      firstName: "Updated",
      lastName: "Driver",
      birthDate: "1996-02-29",
    });
    return profileWrites === 1
      ? route.fulfill({
          status: 503,
          json: { code: "AUTH_REQUEST_FAILED" },
        })
      : route.fulfill({
          json: {
            firstName: "Updated",
            lastName: "Driver",
            birthDate: "1996-02-29",
            role: "DRIVER",
            companyName: null,
          },
        });
  });
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
  const personal = page.getByRole("region", { name: "Personal details" });
  const firstName = personal.getByLabel("First name");
  const birthDate = personal.getByLabel("Date of birth");
  const saveDetails = personal.getByRole("button", { name: "Save details" });
  await expect(firstName).toHaveValue("Test");
  await expect(saveDetails).toBeDisabled();
  await firstName.fill("Updated");
  await birthDate.fill("02/29/1999");
  await saveDetails.click();
  await expect(
    personal.getByText("Enter a valid date of birth."),
  ).toBeVisible();
  expect(profileWrites).toBe(0);
  await birthDate.fill("02/29/1996");
  await saveDetails.click();
  await expect(personal.getByRole("alert")).toBeVisible();
  await expect(firstName).toHaveValue("Updated");
  await expect(birthDate).toHaveValue("02/29/1996");
  await saveDetails.click();
  await expect(personal.getByText("Personal details saved.")).toBeVisible();
  await expect(saveDetails).toBeDisabled();
  await expect(page.getByText("Updated Driver", { exact: true })).toBeVisible();
  expect(profileWrites).toBe(2);
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
  await page
    .getByRole("region", { name: "Active sessions" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
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
    await expect(
      settings.getByRole("img", { name: variant.empty }),
    ).toBeVisible();
    const input = settings.locator('input[type="file"]');
    await expect(
      settings.getByRole("button", { name: variant.upload }),
    ).toBeEnabled();
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
    await expect(
      settings.getByRole("img", { name: variant.title }),
    ).toBeVisible();
    await expect(
      settings.getByRole("button", { name: variant.replace }),
    ).toBeEnabled();
    await input.setInputFiles(file);
    await expect.poll(() => writes).toBe(2);
    const remove = settings.getByRole("button", { name: variant.remove });
    await remove.click();
    await settings.getByRole("button", { name: variant.cancel }).click();
    expect(writes).toBe(2);
    await remove.click();
    await settings.getByRole("button", { name: variant.confirm }).click();
    await expect(settings.getByRole("status")).toHaveText(variant.removed);
    await expect(
      settings.getByRole("img", { name: variant.empty }),
    ).toBeVisible();
    expect(writes).toBe(3);
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });
}

test("Telegram controls use server capability and reject untrusted redirects", async ({
  page,
}) => {
  let enabled = false;
  await page.route("**/api/auth/telegram/status", (route) =>
    route.fulfill({ json: { enabled } }),
  );
  await page.goto("/en/login");
  await expect(
    page.getByRole("button", { name: "Sign in with Telegram" }),
  ).toHaveCount(0);
  enabled = true;
  await page.route("**/api/auth/telegram/start", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      intent: "login",
      locale: "en",
    });
    return route.fulfill({ json: { url: "https://untrusted.invalid/auth" } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Sign in with Telegram" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Unable to sign in with Telegram. Try again.",
  );
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto("/ru/signup");
  await expect(
    page.getByRole("button", { name: "Регистрация через Telegram" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("Telegram onboarding reuses role, profile and username steps without credentials", async ({
  page,
}) => {
  let completed = false;
  let photoRequests = 0;
  const profile = {
    firstName: "Test",
    lastName: "Driver",
    role: "DRIVER",
    birthDate: "1998-05-15",
    companyName: null,
  };
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "telegram-user",
          name: "Test Driver",
          email: null,
          emailVerified: false,
        },
        session: { expiresAt: "2099-01-01T00:00:00Z" },
      },
    }),
  );
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({ json: completed ? profile : null }),
  );
  await page.route("**/api/auth/username", (route) =>
    route.fulfill({
      json:
        route.request().postDataJSON().action === "suggest"
          ? { username: "test_driver" }
          : { available: true },
    }),
  );
  await page.route("**/api/auth/telegram/registration", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      profile: {
        firstName: "Test",
        lastName: "Driver",
        role: "DRIVER",
        birthDate: "1998-05-15",
      },
      username: "test_driver",
    });
    completed = true;
    return route.fulfill({ json: { success: true } });
  });
  await page.route("**/api/auth/profile/photo", (route) => {
    photoRequests++;
    return route.fulfill({
      status: 403,
      json: { code: "AUTH_REQUEST_FAILED" },
    });
  });
  await page.route("**/api/auth/username/settings", (route) =>
    route.fulfill({ json: { username: "test_driver", nextChangeAt: null } }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({ json: { sessions: [], hasMore: false } }),
  );
  await page.goto("/en/account");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Choose your role",
  );
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Driver", exact: true }).click();
  await page.getByLabel("First name").fill("Test");
  await page.getByLabel("Last name").fill("Driver");
  await page.getByLabel("Date of birth").fill("05/15/1998");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
    "test_driver",
  );
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Complete registration" }).click();
  await expect(
    page.getByText("Telegram account", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  await expect(page.locator("#profile-photo-title")).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(photoRequests).toBe(0);
  await expect(page).toHaveURL(/\/en\/account$/);
  await page.reload();
  await expect(
    page.getByText("Telegram account", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#profile-photo-title")).toHaveCount(0);
  expect(photoRequests).toBe(0);
});

test("Telegram settings allow one permanent connection", async ({ page }) => {
  let linked = false;
  let fresh = false;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "email-user",
          name: "Test Driver",
          email: "driver@example.test",
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
  await page.route("**/api/auth/username/settings", (route) =>
    route.fulfill({ json: { username: "test_driver", nextChangeAt: null } }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({ json: { sessions: [], hasMore: false } }),
  );
  await page.route("**/api/auth/telegram/settings", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        linked,
        canLink: !linked,
        requiresFreshSession: !linked && !fresh,
      },
    });
  });
  await page.route("**/api/auth/telegram/start", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      intent: "link",
      locale: "en",
    });
    return route.fulfill({ json: { url: "https://untrusted.invalid/auth" } });
  });
  await page.goto("/en/account?telegram=link-error");
  await page.getByRole("button", { name: "Light theme" }).click();
  const settings = page.getByRole("region", { name: "Telegram", exact: true });
  const connect = settings.getByRole("button", { name: "Connect Telegram" });
  await expect(settings.getByRole("alert")).toBeVisible();
  await expect(connect).toBeDisabled();
  fresh = true;
  await settings.getByRole("button", { name: "Refresh status" }).click();
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(settings.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/en\/account/);
  linked = true;
  await settings.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    settings.getByText(
      "Your Telegram connection cannot be changed or removed.",
    ),
  ).toBeVisible();
  await expect(connect).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Disconnect Telegram" }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});

test("email change requires an explicit confirmation for each link", async ({
  page,
}) => {
  const token = "a".repeat(43);
  const secondToken = "b".repeat(43);
  let confirmations = 0;
  await page.route("**/api/auth/email/change/confirm", (route) => {
    confirmations++;
    const input = route.request().postDataJSON();
    expect(input).toEqual({
      token: confirmations === 1 ? token : secondToken,
    });
    return route.fulfill({
      json: { stage: confirmations === 1 ? "new-sent" : "completed" },
    });
  });
  await page.goto(`/ru/email-change-confirmation#token=${token}`);
  const confirm = page.getByRole("button", {
    name: "Подтвердить смену почты",
  });
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(/\/ru\/email-change-confirmation$/);
  expect(confirmations).toBe(0);
  await expectAccessible(page);
  await confirm.click();
  await expect(page.getByRole("status")).toContainText("Проверьте новую почту");
  expect(confirmations).toBe(1);
  await page.goto(`/en/email-change-confirmation#token=${secondToken}`);
  await expect(page).toHaveURL(/\/en\/email-change-confirmation$/);
  await expect(
    page.getByRole("button", { name: "Confirm email change" }),
  ).toBeVisible();
  expect(confirmations).toBe(1);
  await page.getByRole("button", { name: "Confirm email change" }).click();
  await expect(page.getByRole("status")).toContainText("Email changed.");
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto("/en/email-change-confirmation");
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  expect(confirmations).toBe(2);
});

test("email settings validate the address and retain current email until confirmation", async ({
  page,
}) => {
  let starts = 0;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "email-change-user",
          name: "Test Driver",
          email: "driver@example.test",
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
  await page.route("**/api/auth/username/settings", (route) =>
    route.fulfill({ json: { username: "test_driver", nextChangeAt: null } }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({ json: { sessions: [], hasMore: false } }),
  );
  await page.route("**/api/auth/email/change", (route) => {
    starts++;
    expect(route.request().postDataJSON()).toEqual({
      newEmail: "new@example.test",
      locale: "en",
    });
    return starts === 1
      ? route.fulfill({
          status: 403,
          json: { code: "SESSION_NOT_FRESH" },
        })
      : route.fulfill({ json: { stage: "old-sent" } });
  });
  await page.goto("/en/account");
  const settings = page.getByRole("region", { name: "Change email address" });
  const input = settings.getByLabel("New email address");
  const action = settings.getByRole("button", { name: "Change email" });
  await action.click();
  await expect(
    settings.getByText("Enter a valid email address."),
  ).toBeVisible();
  await input.fill("driver@example.test");
  await action.click();
  await expect(
    settings.getByText("Enter an address different from your current email."),
  ).toBeVisible();
  expect(starts).toBe(0);
  await input.fill("new@example.test");
  await action.click();
  await expect(settings.getByRole("alert")).toContainText(
    "Sign out and sign in again",
  );
  await expect(input).toHaveValue("new@example.test");
  await action.click();
  await expect(settings.getByRole("status")).toContainText(
    "your current email",
  );
  await expect(
    page.getByText("driver@example.test", { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});

test("account deactivation requires confirmation and handles stale sessions", async ({
  page,
}) => {
  let active = true;
  let attempts = 0;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: active
        ? {
            user: {
              id: "deactivation-user",
              name: "Test Driver",
              email: "driver@example.test",
              emailVerified: true,
            },
            session: { expiresAt: "2099-01-01T00:00:00Z" },
          }
        : null,
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
  await page.route("**/api/auth/username/settings", (route) =>
    route.fulfill({ json: { username: "test_driver", nextChangeAt: null } }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({ json: { sessions: [], hasMore: false } }),
  );
  await page.route("**/api/auth/telegram/settings", (route) =>
    route.fulfill({
      json: { linked: false, canLink: false, requiresFreshSession: false },
    }),
  );
  await page.route("**/api/auth/account/deactivate", (route) => {
    attempts++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ confirm: true });
    if (attempts === 1)
      return route.fulfill({
        status: 403,
        json: { code: "SESSION_NOT_FRESH" },
      });
    active = false;
    return route.fulfill({ json: { success: true } });
  });

  await page.goto("/en/account");
  const section = page.getByRole("region", { name: "Account deactivation" });
  const action = section.getByRole("button", { name: "Deactivate account" });
  const confirm = section.getByRole("button", {
    name: "Confirm deactivation",
  });
  const cancel = section.getByRole("button", { name: "Cancel" });
  await expect(confirm).toHaveCount(0);
  await action.click();
  await expect(cancel).toBeFocused();
  await expect(confirm).toBeVisible();
  expect(attempts).toBe(0);
  await cancel.click();
  await expect(action).toBeFocused();
  await expect(confirm).toHaveCount(0);
  expect(attempts).toBe(0);
  await action.click();
  await confirm.click();
  await expect(section.getByRole("alert")).toContainText(
    "Sign out and sign in again",
  );
  await expect(page).toHaveURL(/\/en\/account$/);
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await confirm.click();
  await expect(page.getByRole("status")).toContainText(
    "Your account is deactivated.",
  );
  await expect(section).toHaveCount(0);
  expect(attempts).toBe(2);
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto("/en/account");
  await expect(page).toHaveURL(/\/en\/login$/);
});
