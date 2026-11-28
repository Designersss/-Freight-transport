import { expect, test } from "@playwright/test";
import { registerAuthFixtures } from "./auth-fixtures";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

registerAuthFixtures();

test("email change requires an explicit confirmation for each link", async ({
  page,
}) => {
  const token = "a".repeat(43);
  const secondToken = "b".repeat(43);
  let confirmations = 0;
  await page.route("**/api/auth/email/change/confirm", (route) => {
    confirmations++;
    const input = route.request().postDataJSON();
    expect(input).toEqual({
      token: confirmations === 1 ? token : secondToken,
    });
    return route.fulfill({
      json: { stage: confirmations === 1 ? "new-sent" : "completed" },
    });
  });
  await page.goto(`/ru/email-change-confirmation#token=${token}`);
  const confirm = page.getByRole("button", {
    name: "Подтвердить смену почты",
  });
  await expect(confirm).toBeVisible();
  await expect(page).toHaveURL(/\/ru\/email-change-confirmation$/);
  expect(confirmations).toBe(0);
  await expectAccessible(page);
  await confirm.click();
  await expect(page.getByRole("status")).toContainText("Проверьте новую почту");
  expect(confirmations).toBe(1);
  await page.goto(`/en/email-change-confirmation#token=${secondToken}`);
  await expect(page).toHaveURL(/\/en\/email-change-confirmation$/);
  await expect(
    page.getByRole("button", { name: "Confirm email change" }),
  ).toBeVisible();
  expect(confirmations).toBe(1);
  await page.getByRole("button", { name: "Confirm email change" }).click();
  await expect(page.getByRole("status")).toContainText("Email changed.");
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto("/en/email-change-confirmation");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "invalid or expired",
  );
  expect(confirmations).toBe(2);
});

test("email settings validate the address and retain current email until confirmation", async ({
  page,
}) => {
  let starts = 0;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "email-change-user",
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
  await page.route("**/api/auth/email/change", (route) => {
    starts++;
    expect(route.request().postDataJSON()).toEqual({
      newEmail: "new@example.test",
      locale: "en",
    });
    return starts === 1
      ? route.fulfill({
          status: 403,
          json: { code: "SESSION_NOT_FRESH" },
        })
      : route.fulfill({ json: { stage: "old-sent" } });
  });
  await page.goto("/en/account");
  const settings = page.getByRole("region", { name: "Change email address" });
  const input = settings.getByLabel("New email address");
  const action = settings.getByRole("button", { name: "Change email" });
  await action.click();
  await expect(
    settings.getByText("Enter a valid email address."),
  ).toBeVisible();
  await input.fill("driver@example.test");
  await action.click();
  await expect(
    settings.getByText("Enter an address different from your current email."),
  ).toBeVisible();
  expect(starts).toBe(0);
  await input.fill("new@example.test");
  await action.click();
  await expect(settings.getByRole("alert")).toContainText(
    "Sign out and sign in again",
  );
  await expect(input).toHaveValue("new@example.test");
  await action.click();
  await expect(settings.getByRole("status")).toContainText(
    "your current email",
  );
  await expect(
    page.getByText("driver@example.test", { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});

test("account deactivation requires confirmation and handles stale sessions", async ({
  page,
}) => {
  let active = true;
  let attempts = 0;
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      json: active
        ? {
            user: {
              id: "deactivation-user",
              name: "Test Driver",
              email: "driver@example.test",
              emailVerified: true,
            },
            session: { expiresAt: "2099-01-01T00:00:00Z" },
          }
        : null,
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
  await page.route("**/api/auth/telegram/settings", (route) =>
    route.fulfill({
      json: { linked: false, canLink: false, requiresFreshSession: false },
    }),
  );
  await page.route("**/api/auth/account/deactivate", (route) => {
    attempts++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ confirm: true });
    if (attempts === 1)
      return route.fulfill({
        status: 403,
        json: { code: "SESSION_NOT_FRESH" },
      });
    active = false;
    return route.fulfill({ json: { success: true } });
  });

  await page.goto("/en/account");
  const section = page.getByRole("region", { name: "Account deactivation" });
  const action = section.getByRole("button", { name: "Deactivate account" });
  const confirm = section.getByRole("button", {
    name: "Confirm deactivation",
  });
  const cancel = section.getByRole("button", { name: "Cancel" });
  await expect(confirm).toHaveCount(0);
  await action.click();
  await expect(cancel).toBeFocused();
  await expect(confirm).toBeVisible();
  expect(attempts).toBe(0);
  await cancel.click();
  await expect(action).toBeFocused();
  await expect(confirm).toHaveCount(0);
  expect(attempts).toBe(0);
  await action.click();
  await confirm.click();
  await expect(section.getByRole("alert")).toContainText(
    "Sign out and sign in again",
  );
  await expect(page).toHaveURL(/\/en\/account$/);
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
  await confirm.click();
  await expect(page.getByRole("status")).toContainText(
    "Your account is deactivated.",
  );
  await expect(section).toHaveCount(0);
  expect(attempts).toBe(2);
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/en\/login$/);
  await page.goto("/en/account");
  await expect(page).toHaveURL(/\/en\/login$/);
});
