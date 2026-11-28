import { test } from "@playwright/test";

export function registerAuthFixtures() {
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
}
