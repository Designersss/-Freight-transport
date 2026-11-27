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
