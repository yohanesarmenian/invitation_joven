import { expect, test, type Page } from "@playwright/test";
import { messageItem } from "../tests/message-fixtures";

async function login(page: Page, email = "message-owner@example.com") {
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

test.beforeEach(async ({ page }) => {
  page.on("pageerror", () => {
    throw new Error("Unexpected browser error");
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      throw new Error("Unexpected browser console error");
    }
  });
});

test("message list filters, pagination, scoped context and safe text rendering", async ({
  page,
}) => {
  await login(page);
  await page.goto("/messages");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(12);
  await expect(
    page.getByText("Congratulations from <script>window.__xss = true</script>"),
  ).toBeVisible();
  await expect(page.locator("script", { hasText: "window.__xss" })).toHaveCount(
    0,
  );
  await expect(page.locator("body")).not.toContainText("tokenHash");
  await expect(page.getByRole("cell", { name: "Anonymous guest" }).first()).toBeVisible();
  await page.getByLabel("Visibility").selectOption("hidden");
  await page.getByLabel("Sort direction").selectOption("asc");
  await page.getByLabel("Per page").fill("2");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/hidden=hidden/);
  await expect(page).toHaveURL(/pageSize=2/);
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);

  await page.goto(`/messages?invitationId=${messageItem.invitation.id}`);
  await expect(
    page.getByRole("heading", { name: "Sample household" }),
  ).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
  await expect(page.locator("body")).not.toContainText("Message Household 04");
});

test("message empty, no matches, beyond last and invalid URL are distinct", async ({
  page,
}) => {
  await login(page, "message-empty@example.com");
  await page.goto("/messages");
  await expect(
    page.getByRole("heading", { name: "No guest messages yet" }),
  ).toBeVisible();
  await page.context().clearCookies();
  await login(page);
  await page.goto("/messages?hidden=hidden&invitationId=dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  await expect(
    page.getByRole("heading", { name: "No matching messages" }),
  ).toBeVisible();
  await page.goto("/messages?hidden=maybe");
  await expect(
    page.getByRole("heading", { name: "Invalid message filters" }),
  ).toBeVisible();
  await page.goto("/messages?page=99");
  await expect(
    page.getByRole("heading", { name: "No messages on this page" }),
  ).toBeVisible();
});

test("message moderation hides once with exact payload and authoritative refresh", async ({
  page,
}) => {
  const patches: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      /\/api\/admin\/messages\/[^/]+$/.test(request.url())
    )
      patches.push(request.postData() ?? "");
  });
  await login(page);
  await page.goto("/messages?hidden=visible&pageSize=10");
  await page.getByRole("button", { name: "Hide message" }).first().click();
  await page
    .getByRole("dialog", { name: "Hide message" })
    .getByRole("button", { name: "Hide message" })
    .dblclick();
  await expect(page.getByRole("table")).not.toContainText(
    "Congratulations from <script>",
  );
  expect(patches).toHaveLength(1);
  expect(JSON.parse(patches[0]!)).toEqual({ isHidden: true });
});

test("message moderation CSRF refresh and uncertain outcomes do not replay", async ({
  page,
}) => {
  const csrfPatches: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      /\/api\/admin\/messages\/[^/]+$/.test(request.url())
    )
      csrfPatches.push(request.postData() ?? "");
  });
  await login(page, "message-csrf@example.com");
  await page.goto("/messages");
  await page.getByRole("button", { name: "Unhide message" }).first().click();
  await page
    .getByRole("dialog", { name: "Unhide message" })
    .getByRole("button", { name: "Unhide message" })
    .click();
  await expect(
    page.getByText("Your session was refreshed. The message visibility change was not replayed."),
  ).toBeVisible();
  expect(csrfPatches).toHaveLength(1);

  const uncertainPatches: string[] = [];
  page.removeAllListeners("request");
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      /\/api\/admin\/messages\/[^/]+$/.test(request.url())
    )
      uncertainPatches.push(request.postData() ?? "");
  });
  await page.context().clearCookies();
  await login(page, "message-uncertain@example.com");
  await page.goto("/messages");
  await page.getByRole("button", { name: "Unhide message" }).first().click();
  await page
    .getByRole("dialog", { name: "Unhide message" })
    .getByRole("button", { name: "Unhide message" })
    .click();
  await expect(page.getByText("could not be confirmed")).toBeVisible();
  await expect(page.locator(".dashboard-retry")).toHaveText(
    "Reload message list",
  );
  expect(uncertainPatches).toHaveLength(1);
});

for (const [email, title] of [
  ["message-error@example.com", "Unable to load messages"],
  ["message-forbidden@example.com", "Message access unavailable"],
  ["message-malformed@example.com", "Unable to load messages"],
])
  test(`bounded message read failure ${email}`, async ({ page }) => {
    await login(page, email);
    await page.goto("/messages");
    await expect(
      page.getByRole("heading", { name: title!, exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Private diagnostic");
  });

test("message 401 reads use generic session-ended route", async ({ page }) => {
  await login(page, "message-ended@example.com");
  await page.goto("/messages");
  await expect(page).toHaveURL(/\/login\?session=ended$/);
  await expect(
    page.getByText("Your admin session has ended. Please sign in again."),
  ).toBeVisible();
});

test("message list fits all required widths", async ({ page }) => {
  await login(page);
  for (const width of [320, 375, 412, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/messages");
    await expect(
      page.getByRole("heading", { name: "Messages", exact: true }),
    ).toBeVisible();
    const bodyWidth = await page
      .locator("body")
      .evaluate((body) => body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(width + 1);
  }
});
