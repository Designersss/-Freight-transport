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
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Введите корректный email.")).toBeVisible();
  await expect(page.getByText("Проверьте длину пароля.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.getByRole("button", { name: "Светлая тема" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Sign in to MOVARO",
  );
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
