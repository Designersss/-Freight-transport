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
  ).toBeDisabled();
  await expect(
    page.getByText("Telegram sign-in is currently unavailable."),
  ).toBeVisible();
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
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Unable to sign in with Telegram. Try again.",
  );
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto("/ru/signup");
  await expect(
    page.getByRole("button", { name: "Регистрация через Telegram" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Электронная почта" }),
  ).toBeVisible();
  await expect(page.getByText(/^Шаг \d+ из \d+$/)).toHaveCount(0);
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
  await expect(page.getByText("Step 1 of 3", { exact: true })).toBeVisible();
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
  await page.route("**/api/auth/telegram/status", (route) =>
    route.fulfill({ json: { enabled: true } }),
  );
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

test("Telegram bot signup waits, returns with a fragment and resumes the shared draft", async ({
  page,
}) => {
  const requestId = "1b7a89d1-1b4a-4a76-8a5a-548744bcac44";
  const proof = "b".repeat(43);
  const deepLink = "a".repeat(43);
  let confirmed = false;
  const draft = {
    id: requestId,
    channel: "web",
    locale: "en",
    revision: 0,
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    firstName: "Synthetic",
    lastName: "Driver",
    role: null,
    birthDate: null,
    companyName: null,
    username: null,
  };
  await page.route("**/api/auth/telegram/status", (route) =>
    route.fulfill({ json: { enabled: true, mode: "bot" } }),
  );
  await page.route("**/api/auth/telegram-bot/browser", (route) => {
    const command = route.request().postDataJSON();
    if (command.action === "start") {
      expect(command).toEqual({
        action: "start",
        intent: "register",
        locale: "en",
      });
      return route.fulfill({
        json: {
          requestId,
          url: `https://t.me/synthetic_movaro_bot?start=${deepLink}`,
          displayCode: "123456",
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
      });
    }
    if (command.action === "status")
      return route.fulfill({
        json: { status: confirmed ? "approved" : "pending" },
      });
    if (command.action === "confirm") {
      expect(command).toEqual({ action: "confirm", requestId, proof });
      expect(route.request().url()).not.toContain(proof);
      confirmed = true;
      return route.fulfill({ json: { success: true } });
    }
    if (command.action === "finish") {
      expect(confirmed).toBe(true);
      return route.fulfill({
        json: { outcome: "registration", draftId: requestId },
      });
    }
    if (command.action === "draft-find")
      return route.fulfill({ json: { draft } });
    return route.fulfill({ status: 400, json: { code: "INVALID_REQUEST" } });
  });
  await page.goto("/en/signup");
  await page.getByRole("button", { name: "Register with Telegram" }).click();
  await expect(page).toHaveURL(/\/en\/telegram\/wait$/);
  await expect(page.getByText("123456", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Telegram" }),
  ).toHaveAttribute(
    "href",
    `https://t.me/synthetic_movaro_bot?start=${deepLink}`,
  );
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
  await page.goto(`/en/telegram/return#requestId=${requestId}&proof=${proof}`);
  await expect(page).toHaveURL(/\/en\/telegram\/registration$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Choose your role",
  );
  await expect(page.getByText("Step 1 of 3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(confirmed).toBe(true);
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
});

test("Telegram registration reports completion only after a verified receipt", async ({ page }) => {
  const draftId = "1b7a89d1-1b4a-4a76-8a5a-548744bcac44";
  let completed = false;
  const draft = {
    id: draftId,
    channel: "bot",
    locale: "en",
    revision: 2,
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    firstName: "Synthetic",
    lastName: "Driver",
    role: "DRIVER",
    birthDate: "1990-01-01",
    companyName: null,
    username: "synthetic_driver",
  };
  await page.route("**/api/auth/telegram-bot/browser", (route) => {
    const command = route.request().postDataJSON();
    if (command.action === "draft-find")
      return route.fulfill({ json: { draft } });
    if (command.action === "draft-state") {
      expect(command.draftId).toBe(draftId);
      return route.fulfill({
        json: { draft: completed ? null : draft, completed },
      });
    }
    return route.fulfill({ status: 400, json: { code: "INVALID_REQUEST" } });
  });
  await page.goto("/en/telegram/registration");
  await expect(page.getByRole("button", { name: "Continue on the website" })).toBeVisible();
  await expect(page.getByText("Account created. Sign in with Telegram.")).toHaveCount(0);
  completed = true;
  await expect(page.getByText("Account created. Sign in with Telegram.")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("link", { name: "Sign in with Telegram" })).toBeVisible();
});
