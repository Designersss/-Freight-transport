import { expect, test } from "@playwright/test";
import { registerAuthFixtures } from "./auth-fixtures";
import { expectAccessible, expectNoHorizontalOverflow } from "./helpers";

registerAuthFixtures();

test("registration wizard preserves profile after conflict and network failure", async ({
  page,
}) => {
  await page.route("**/api/auth/username", (route) => {
    const data = route.request().postDataJSON();
    return route.fulfill({
      json:
        data.action === "suggest"
          ? { username: "test_user" }
          : { available: true },
    });
  });
  let attempts = 0;
  const token = "a".repeat(43);
  await page.route("**/api/auth/registration/email/start", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "user@example.test",
      locale: "en",
    });
    return route.fulfill({ json: { success: true } });
  });
  await page.route("**/api/auth/registration/email/read", (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    return route.fulfill({ json: { email: "user@example.test" } });
  });
  await page.route("**/api/auth/registration/email/complete", async (route) => {
    attempts++;
    const data = route.request().postDataJSON();
    expect(data).not.toHaveProperty("name");
    expect(data).not.toHaveProperty("image");
    expect(data).not.toHaveProperty("email");
    expect(data.token).toBe(token);
    expect(Object.keys(data.registration).sort()).toEqual([
      "profile",
      "username",
    ]);
    expect(data.registration.profile).toEqual({
      firstName: "Test",
      lastName: "User",
      role: "COMPANY_OWNER",
      birthDate: "1998-05-15",
      companyName: "Test Company",
    });
    if (attempts === 1) {
      expect(data.registration.username).toBe("test_user");
      await route.fulfill({
        status: 409,
        json: { code: "USERNAME_TAKEN" },
      });
    } else {
      expect(data.registration.username).toBe("test_user2");
      await route.abort();
    }
  });
  await page.goto("/en/signup");
  await expect(page.getByText(/^Step \d+ of \d+$/)).toHaveCount(0);
  await page.getByRole("button", { name: /^Email address / }).click();
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const email = page.getByLabel("Email address");
  const password = page.getByLabel("Password", { exact: true });
  const next = page.getByRole("button", { name: "Continue", exact: true });
  const back = page.getByRole("button", { name: "Back", exact: true });
  const heading = page.getByRole("heading", { level: 1 });
  await email.fill("user@example.test");
  await expect(password).toHaveCount(0);
  await expect(page.getByText(/^Step \d+ of \d+$/)).toHaveCount(0);
  await next.click();
  await expect(heading).toHaveText("Confirm your email");
  await expect(page.getByText(/^Step \d+ of \d+$/)).toHaveCount(0);
  await page.goto("/en/login");
  await page.goto(`/en/signup#token=${token}`);
  await page.getByRole("button", { name: "Confirm email" }).click();
  await expect(heading).toHaveText("Choose a password");
  await expect(page.getByText("Step 1 of 4", { exact: true })).toBeVisible();
  await expect(email).toHaveValue("user@example.test");
  await expect(email).not.toBeEditable();
  await password.fill("test-password");
  await next.click();
  await expect(heading).toHaveText("Choose your role");
  await expect(page.getByText("Step 2 of 4", { exact: true })).toBeVisible();
  await expect(heading).toBeFocused();
  await page.getByRole("button", { name: /^Driver / }).click();
  await expect(heading).toHaveText("Complete your profile");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const first = page.getByLabel("First name", { exact: true });
  const last = page.getByLabel("Last name", { exact: true });
  await first.fill("Test");
  await last.fill("User");
  await page.getByLabel("Date of birth").fill("05/15/1998");
  await expect(page.getByLabel("Company name")).toHaveCount(0);
  await back.click();
  await page.getByRole("button", { name: /^Dispatcher / }).click();
  await expect(first).toHaveValue("Test");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByLabel("Company name")).toHaveCount(0);
  await back.click();
  await page.getByRole("button", { name: /^Company owner / }).click();
  await expect(last).toHaveValue("User");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByLabel("Date of birth")).toHaveValue("05/15/1998");
  await page.getByLabel("Company name").fill("Test Company");
  await next.click();
  await expect(heading).toHaveText("Choose a username");
  await expect(page.getByText("Step 4 of 4", { exact: true })).toBeVisible();
  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toHaveValue("test_user");
  await expectAccessible(page);
  await expectNoHorizontalOverflow(page);
  const submit = page.getByRole("button", { name: "Create account" });
  await submit.click();
  await expect(page.locator("#username-error")).toHaveText(
    "This name is already taken.",
  );
  await expect(username).toHaveValue("test_user");
  await username.fill("test_user2");
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Authentication is unavailable. Try again later.",
  );
  await expect(heading).toHaveText("Choose a username");
  await expect(username).toHaveValue("test_user2");
  await back.click();
  await expect(first).toHaveValue("Test");
  await expect(last).toHaveValue("User");
  await expect(page.getByLabel("Company name")).toHaveValue("Test Company");
  await next.click();
  await expect(username).toHaveValue("test_user2");
  expect(attempts).toBe(2);
  await expect(page).toHaveURL(/\/en\/signup$/);
  await expect(page).toHaveTitle("MOVARO");
});

test("registration method navigation respects reduced motion and keyboard", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/en/signup");
  const step = page.locator(".movaro-signup-step");
  const email = page.getByRole("button", {
    name: /^Email address /,
  });
  await expect(step).toHaveCSS("animation-name", "movaro-signup-step-in");
  await email.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Register with email",
  );
  await expect(step).toHaveAttribute("data-direction", "forward");
  await expect(step).toHaveCSS("animation-duration", "0.22s");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(step).toHaveAttribute("data-direction", "backward");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(step).toHaveCSS("animation-name", "none");
  await expect(email).toHaveCSS("transition-duration", "0s");
  await expectNoHorizontalOverflow(page);
  await expectAccessible(page);
});
