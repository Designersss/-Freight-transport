import { expect, test } from "@playwright/test";
import { registerAuthFixtures } from "./auth-fixtures";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

registerAuthFixtures();

test("Telegram controls use server capability and reject untrusted redirects", async ({
  page,
}) => {
  let enabled = false;
  await page.route("**/api/auth/telegram/status", (route) =>
    route.fulfill({ json: { enabled } }),
  );
  await page.goto("/en/login");
  await expect(
    page.getByRole("button", { name: "Sign in with Telegram" }),
  ).toHaveCount(0);
  enabled = true;
  await page.route("**/api/auth/telegram/start", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      intent: "login",
      locale: "en",
    });
    return route.fulfill({ json: { url: "https://untrusted.invalid/auth" } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Sign in with Telegram" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Unable to sign in with Telegram. Try again.",
  );
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto("/ru/signup");
  await expect(
    page.getByRole("button", { name: "Регистрация через Telegram" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("Telegram onboarding reuses role, profile and username steps without credentials", async ({
  page,
}) => {
  let completed = false;
  let photoRequests = 0;
  const profile = {
    firstName: "Test",
    lastName: "Driver",
    role: "DRIVER",
    birthDate: "1998-05-15",
    companyName: null,
  };
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "telegram-user",
          name: "Test Driver",
          email: null,
          emailVerified: false,
        },
        session: { expiresAt: "2099-01-01T00:00:00Z" },
      },
    }),
  );
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({ json: completed ? profile : null }),
  );
  await page.route("**/api/auth/username", (route) =>
    route.fulfill({
      json:
        route.request().postDataJSON().action === "suggest"
          ? { username: "test_driver" }
          : { available: true },
    }),
  );
  await page.route("**/api/auth/telegram/registration", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      profile: {
        firstName: "Test",
        lastName: "Driver",
        role: "DRIVER",
        birthDate: "1998-05-15",
      },
      username: "test_driver",
    });
    completed = true;
    return route.fulfill({ json: { success: true } });
  });
  await page.route("**/api/auth/profile/photo", (route) => {
    photoRequests++;
    return route.fulfill({
      status: 403,
      json: { code: "AUTH_REQUEST_FAILED" },
    });
  });
  await page.route("**/api/auth/username/settings", (route) =>
    route.fulfill({ json: { username: "test_driver", nextChangeAt: null } }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({ json: { sessions: [], hasMore: false } }),
  );
  await page.goto("/en/account");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Choose your role",
  );
  await expect(page.getByLabel("Email address")).toHaveCount(0);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Driver", exact: true }).click();
  await page.getByLabel("First name").fill("Test");
  await page.getByLabel("Last name").fill("Driver");
  await page.getByLabel("Date of birth").fill("05/15/1998");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
    "test_driver",
  );
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Complete registration" }).click();
  await expect(
    page.getByText("Telegram account", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Current password")).toHaveCount(0);
  await expect(page.locator("#profile-photo-title")).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(photoRequests).toBe(0);
  await expect(page).toHaveURL(/\/en\/account$/);
  await page.reload();
  await expect(
    page.getByText("Telegram account", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#profile-photo-title")).toHaveCount(0);
  expect(photoRequests).toBe(0);
});

test("Telegram settings allow one permanent connection", async ({ page }) => {
  let linked = false;
  let fresh = false;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "email-user",
          name: "Test Driver",
          email: "driver@example.test",
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
  await page.route("**/api/auth/username/settings", (route) =>
    route.fulfill({ json: { username: "test_driver", nextChangeAt: null } }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({ json: { sessions: [], hasMore: false } }),
  );
  await page.route("**/api/auth/telegram/settings", (route) => {
    expect(route.request().method()).toBe("GET");
    return route.fulfill({
      json: {
        linked,
        canLink: !linked,
        requiresFreshSession: !linked && !fresh,
      },
    });
  });
  await page.route("**/api/auth/telegram/start", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      intent: "link",
      locale: "en",
    });
    return route.fulfill({ json: { url: "https://untrusted.invalid/auth" } });
  });
  await page.goto("/en/account?telegram=link-error");
  await page.getByRole("button", { name: "Light theme" }).click();
  const settings = page.getByRole("region", { name: "Telegram", exact: true });
  const connect = settings.getByRole("button", { name: "Connect Telegram" });
  await expect(settings.getByRole("alert")).toBeVisible();
  await expect(connect).toBeDisabled();
  fresh = true;
  await settings.getByRole("button", { name: "Refresh status" }).click();
  await expect(connect).toBeEnabled();
  await connect.click();
  await expect(settings.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/en\/account/);
  linked = true;
  await settings.getByRole("button", { name: "Refresh status" }).click();
  await expect(
    settings.getByText(
      "Your Telegram connection cannot be changed or removed.",
    ),
  ).toBeVisible();
  await expect(connect).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "Disconnect Telegram" }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});
