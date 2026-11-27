import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

test("anonymous admin only sees localized sign-in without protected navigation", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/ru");
  await expect(page).toHaveURL(/\/ru\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Вход в администрирование",
  );
  await expect(
    page.getByRole("navigation", { name: "Основная навигация" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Введите корректный email.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Administrator sign in",
  );
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});

test("production admin remains unavailable until authorization", async ({
  request,
}) => {
  for (const locale of ["ru", "en"]) {
    for (const path of ["", "/login"]) {
      const response = await request.get(
        `http://127.0.0.1:3102/${locale}${path}`,
      );
      expect(response.status()).toBe(404);
    }
  }
  const api = await request.get("http://127.0.0.1:3102/api/auth/get-session");
  expect(api.status()).toBe(404);
});
