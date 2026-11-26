import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

test("development admin has localized active navigation and responsive layout", async ({ page }) => {
  await page.goto("http://127.0.0.1:3101/ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Администрирование");
  const navigation = page.getByRole("navigation", { name: "Основная навигация" });
  await expect(navigation.getByRole("link", { name: "Администрирование" })).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Administration");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});

test("production admin remains unavailable until authorization", async ({ request }) => {
  for (const locale of ["ru", "en"]) {
    const response = await request.get(`http://127.0.0.1:3102/${locale}`);
    expect(response.status()).toBe(404);
  }
});
