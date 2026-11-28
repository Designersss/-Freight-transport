import { expect, test } from "@playwright/test";
import { registerAuthFixtures } from "./auth-fixtures";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

registerAuthFixtures();

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

for (const language of [
  {
    locale: "ru",
    password: "Новый пароль",
    submit: "Сохранить пароль",
    done: "Пароль изменён. Войдите с новым паролем.",
    registered: "Аккаунт создан. Теперь вы можете войти.",
    error: "Не удалось выполнить запрос. Проверьте данные и повторите попытку.",
    light: "Светлая тема",
  },
  {
    locale: "en",
    password: "New password",
    submit: "Save password",
    done: "Password changed. Sign in with your new password.",
    registered: "Your account is ready. You can now sign in.",
    error: "Request failed. Check your details and try again.",
    light: "Light theme",
  },
]) {
  for (const theme of ["dark", "light"]) {
    test(`password reset feedback: ${language.locale}, ${theme}`, async ({
      page,
    }) => {
      let attempts = 0;
      await page.route("**/api/auth/reset-password", (route) => {
        expect(route.request().postDataJSON()).toEqual({
          token: "test-reset-token",
          newPassword: "test-password",
        });
        attempts++;
        return route.fulfill(
          attempts === 1
            ? { status: 400, json: { code: "INVALID_TOKEN" } }
            : { json: { success: true } },
        );
      });
      const login = `/${language.locale}/login`;
      const reset = `/${language.locale}/reset-password?token=test-reset-token`;
      await page.goto(login);
      await expect(page.getByText(language.done, { exact: true })).toHaveCount(
        0,
      );
      if (theme === "light") {
        await page.getByRole("button", { name: language.light }).click();
      }
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.goto(reset);
      const password = page.getByLabel(language.password, { exact: true });
      const submit = page.getByRole("button", { name: language.submit });
      await password.fill("test-password");
      await submit.click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        language.error,
      );
      await expect(page).toHaveURL(reset);
      await expect(page.getByText(language.done, { exact: true })).toHaveCount(
        0,
      );
      await expect(password).toHaveValue("");
      await password.fill("test-password");
      await submit.click();
      await expect(page).toHaveURL(`${login}?reset=done`);
      await expect(page.getByRole("main").getByRole("status")).toHaveText(
        language.done,
      );
      await expect(
        page.getByText(language.registered, { exact: true }),
      ).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(attempts).toBe(2);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
      await page.goto(`${login}?verified=done`);
      await expect(page.getByRole("main").getByRole("status")).toHaveText(
        language.registered,
      );
      await expect(page.getByText(language.done, { exact: true })).toHaveCount(
        0,
      );
    });
  }
}

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
