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

test("registration preserves name and email after a network failure", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-up/email", (route) => route.abort());
  await page.goto("/en/signup");
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const name = page.getByLabel("Name", { exact: true });
  const email = page.getByLabel("Email address");
  const password = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Create account" });
  await name.fill("Test User");
  await email.fill("user@example.test");
  await password.fill("test-password");
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Authentication is unavailable. Try again later.",
  );
  await expect(name).toHaveValue("Test User");
  await expect(email).toHaveValue("user@example.test");
  await expect(password).toHaveValue("");
  await expect(submit).toBeEnabled();
  await expect(page).toHaveURL(/\/en\/signup$/);
  await expect(page).toHaveTitle("MOVARO");
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
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
    await expect(calendar.getByLabel(variant.month)).toHaveValue("4");
    await expect(calendar.getByLabel(variant.year)).toHaveValue("1998");
    await expect(
      calendar.locator('[aria-selected="true"] button'),
    ).toHaveText("15");
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
