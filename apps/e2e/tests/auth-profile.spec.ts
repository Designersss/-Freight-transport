import { expect, test } from "@playwright/test";
import { registerAuthFixtures } from "./auth-fixtures";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

registerAuthFixtures();

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
