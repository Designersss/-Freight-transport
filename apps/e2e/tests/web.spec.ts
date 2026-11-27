import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

test("public route redirects to default locale and preserves query parameters during language switch", async ({
  page,
}) => {
  await page.goto("/?filter=a&filter=b");
  await expect(page).toHaveURL(/\/ru\?/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Управление арендой техники",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page).toHaveURL(/\/en\?/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Equipment rental management",
  );
  expect(new URL(page.url()).searchParams.getAll("filter")).toEqual(["a", "b"]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("link", { name: "EN", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
});

test("theme persists across reload and language navigation", async ({
  page,
}) => {
  await page.goto("/ru");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Светлая тема" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
});

test("keyboard skip link reaches main content and public page has no detected WCAG violations", async ({
  page,
}) => {
  await page.goto("/ru");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Перейти к содержимому" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expectNoHorizontalOverflow(page);
  const login = page.getByRole("link", { name: "Вход", exact: true });
  await expect(login).toHaveCSS("transition-property", "none");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Светлая тема" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectAccessible(page);
});
