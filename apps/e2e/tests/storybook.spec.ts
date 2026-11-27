import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

const storybook = "http://127.0.0.1:6106";
// Playwright owns the axe run in these previews, not Storybook’s addon.
const manualA11y = "a11y.manual:!true";

for (const variant of [
  {
    locale: "ru",
    theme: "dark",
    name: "Имя",
    save: "Сохранить",
    error: "Укажите имя",
    success: "Проверка пройдена",
  },
  {
    locale: "en",
    theme: "light",
    name: "Name",
    save: "Save",
    error: "Enter a name",
    success: "Validation passed",
  },
] as const) {
  test(`Storybook form validation and accessibility: ${variant.locale}/${variant.theme}`, async ({
    page,
  }) => {
    await page.goto(
      `${storybook}/iframe.html?id=movaro-forms-validation--interactive&viewMode=story&globals=locale:${variant.locale};theme:${variant.theme};${manualA11y}`,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      variant.theme,
    );
    await expect(page.locator("html")).toHaveAttribute("lang", variant.locale);
    const input = page.getByRole("textbox", {
      name: variant.name,
      exact: true,
    });
    const save = page.getByRole("button", { name: variant.save, exact: true });
    await expect(input).toBeVisible();
    await expectAccessible(page);
    await save.click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toHaveText(variant.error);
    await expectAccessible(page);
    await input.fill("Test");
    await save.click();
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByRole("status")).toHaveText(variant.success);
    await expectNoHorizontalOverflow(page);
  });
}

test("Storybook table renders semantic header and rows", async ({ page }) => {
  await page.goto(
    `${storybook}/iframe.html?id=movaro-data-table--basic&viewMode=story&globals=${manualA11y}`,
  );
  const table = page.getByRole("table", { name: "Тестовые данные Storybook" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  await expect(table.getByRole("row")).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});
