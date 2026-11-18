import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email = "owner@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}

test("staff feedback distinguishes confirmed success, rejection and uncertainty", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings/staff");
  const email = page.getByLabel("Staff email");
  const create = page.getByRole("button", {
    name: "Create staff account",
    exact: true,
  });
  const feedbackOperator = "feedback-operator@example.com";
  await email.fill(feedbackOperator);
  await create.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Staff created." }),
  ).toHaveClass(/action-feedback--success/);
  await page
    .getByRole("button", { name: "Dismiss temporary password" })
    .click();
  await email.fill(feedbackOperator);
  const duplicate = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/admin/staff",
  );
  await create.click();
  expect((await duplicate).status()).toBe(409);
  await expect(page.getByRole("main").getByRole("alert")).toHaveClass(
    /action-feedback--error/,
  );
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "conflicts with the account state",
  );
  await email.fill("lost-response-feedback-operator@example.com");
  await create.click();
  await expect(
    page.getByRole("status").filter({ hasText: "outcome is unknown" }),
  ).toHaveClass(/action-feedback--warning/);
});

test("personal message feedback announces preview, successful copy and read failure", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "http://localhost:3001",
  });
  await login(page, "list-owner@example.com");
  await page.goto("/invitations");
  await page.getByRole("link", { name: "Household 01", exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare personal message", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Review the wording" }),
  ).toHaveClass(/action-feedback--info/);
  await page
    .getByRole("button", { name: "Copy personal message", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Personal invitation message copied." }),
  ).toHaveClass(/action-feedback--success/);
  await page.route("**/api/admin/invitations/*/public-url", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } }),
  );
  await page
    .getByRole("button", { name: "Prepare personal message", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveClass(
    /action-feedback--error/,
  );
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Unable to read the current invitation link",
  );
});

test("personal message clipboard fallback uses a nonfatal warning", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Synthetic clipboard failure");
        },
      },
    });
  });
  await login(page, "list-owner@example.com");
  await page.goto("/invitations");
  await page.getByRole("link", { name: "Household 01", exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare personal message", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy personal message", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Clipboard unavailable" }),
  ).toHaveClass(/action-feedback--warning/);
});
