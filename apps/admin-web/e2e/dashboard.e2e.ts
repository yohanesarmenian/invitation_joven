import { expect, test, type Page } from "@playwright/test";
async function login(page: Page, email = "owner@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  page.on("pageerror", () => {
    throw new Error("Unexpected browser page error");
  });
});
test("real DTO fields, exact navigation and backend event order", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  for (const [label, value] of [
    ["Active Invitations", "7"],
    ["Archived Invitations", "2"],
    ["Opened Active Invitations", "5"],
    ["Pending", "3"],
    ["Accepted", "9"],
    ["Declined", "4"],
  ])
    await expect(
      page
        .locator(".metric")
        .filter({ has: page.getByText(label!, { exact: true }) })
        .locator("dd"),
    ).toHaveText(value!);
  await expect(page.getByRole("table").locator("tbody tr")).toHaveText([
    "Wedding ceremony11",
    "Reception6",
  ]);
  const nav = page.getByRole("navigation");
  for (const [label, path] of [
    ["Dashboard", "/"],
    ["Invitations", "/invitations"],
    ["RSVPs", "/rsvps"],
    ["Messages", "/messages"],
  ])
    await expect(nav.getByRole("link", { name: label! })).toHaveAttribute(
      "href",
      path!,
    );
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
test("zero and empty attendance remain valid data", async ({ page }) => {
  await login(page, "dashboard-empty@example.com");
  await expect(page.locator("dd")).toHaveText(["0", "0", "0", "0", "0", "0"]);
  await expect(
    page.getByText("No accepted attending RSVPs yet."),
  ).toBeVisible();
});
for (const [email, title] of [
  ["dashboard-error@example.com", "Unable to load dashboard"],
  ["dashboard-malformed@example.com", "Unable to load dashboard"],
  ["dashboard-forbidden@example.com", "Dashboard access unavailable"],
])
  test(`safe dashboard failure ${email}`, async ({ page }) => {
    await login(page, email);
    await expect(
      page.getByRole("heading", { name: title!, exact: true }),
    ).toBeVisible();
    await expect(page.locator("dd")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByText("Private backend diagnostic")).toHaveCount(0);
  });
test("dashboard 401 ends the session", async ({ page }) => {
  await login(page, "dashboard-ended@example.com");
  await expect(
    page.getByText("Your admin session has ended. Please sign in again."),
  ).toBeVisible();
  await expect(page.locator("dd")).toHaveCount(0);
});
test("loading announces progress without fake metrics", async ({ page }) => {
  await login(page, "dashboard-slow@example.com");
  await expect(page.getByText("Loading dashboard…")).toBeVisible();
  await expect(page.locator("dd")).toHaveCount(0);
  await expect(page.locator("dd")).toHaveCount(6);
});
for (const width of [320, 375, 412, 768, 1280])
  test(`dashboard responsive ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page);
    await expect(page.locator("dd")).toHaveCount(6);
    if (width <= 760) {
      const toggle = page.getByRole("button", { name: "Open navigation" });
      await expect(page.getByRole("navigation")).toBeHidden();
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("navigation")).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Dashboard", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await page.getByRole("link", { name: "Dashboard", exact: true }).click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${width}.png`),
      fullPage: true,
      caret: "initial",
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL("http://localhost:3001/login");
  });
