import { expect, test, type Page } from "@playwright/test";
import { rsvpEvents } from "../tests/rsvp-fixtures";

async function login(page: Page, email = "rsvp-owner@example.com") {
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

test("RSVP list filters, pagination, persisted rows and navigation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/rsvps");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(12);
  await expect(
    page.getByRole("rowheader", { name: /RSVP Household 01/ }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("OWNER");
  await expect(page.getByRole("table")).toContainText("Guest");
  await page.getByLabel("Search RSVPs", { exact: true }).fill("  Household  ");
  await page.getByLabel("RSVP status", { exact: true }).selectOption("ACCEPTED");
  await page.getByLabel("Event", { exact: true }).selectOption(rsvpEvents[1]!.id);
  await page.getByLabel("Sort by", { exact: true }).selectOption("status");
  await page.getByLabel("Sort direction").selectOption("asc");
  await page.getByLabel("Per page").fill("2");
  await page.getByRole("button", { name: "Apply search and filters" }).click();
  await expect(page).toHaveURL(/search=Household/);
  await expect(page).toHaveURL(/eventId=/);
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText("No RSVP");
  await page.reload();
  await expect(page.getByLabel("Search RSVPs", { exact: true })).toHaveValue(
    "Household",
  );
  await page.getByRole("table").getByRole("link").first().click();
  await expect(
    page.getByRole("heading", { name: "RSVP detail", exact: true }),
  ).toBeVisible();
});

test("RSVP empty, no matches, beyond last and invalid URL are distinct", async ({
  page,
}) => {
  await login(page, "rsvp-empty@example.com");
  await page.goto("/rsvps");
  await expect(
    page.getByRole("heading", { name: "No persisted RSVPs yet" }),
  ).toBeVisible();
  await page.goto("/rsvps?search=absent");
  await expect(
    page.getByRole("heading", { name: "No matching RSVPs" }),
  ).toBeVisible();
  await page.goto("/rsvps?status=invalid");
  await expect(
    page.getByRole("heading", { name: "Invalid search or filters" }),
  ).toBeVisible();
  await page.context().clearCookies();
  await login(page);
  await page.goto("/rsvps?page=99");
  await expect(
    page.getByRole("heading", { name: "No RSVPs on this page" }),
  ).toBeVisible();
});

test("RSVP detail renders snapshots and safe pass metadata only", async ({
  page,
}) => {
  await login(page);
  await page.goto("/rsvps/aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
  await expect(page.getByText("Snapshot Guest", { exact: true })).toBeVisible();
  await expect(page.getByText("Snapshot Companion")).toBeVisible();
  await expect(
    page.getByRole("rowheader", { name: "Additional child", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("row", { name: /Reception Yes 4/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Ceremony No 0/ })).toBeVisible();
  await expect(page.getByText("Vegetarian")).toBeVisible();
  await expect(page.getByText("owner@example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("Guest replied by phone")).toBeVisible();
  await expect(page.getByText("RSVP_DECLINED")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("qrPayload");
  await expect(page.locator("body")).not.toContainText("tokenHash");
  await expect(page.locator("body")).not.toContainText("publicTokenHash");
});

for (const [email, title] of [
  ["rsvp-error@example.com", "Unable to load RSVPs"],
  ["rsvp-forbidden@example.com", "RSVP access unavailable"],
  ["rsvp-malformed@example.com", "Unable to load RSVPs"],
])
  test(`bounded RSVP read failure ${email}`, async ({ page }) => {
    await login(page, email);
    await page.goto("/rsvps");
    await expect(
      page.getByRole("heading", { name: title!, exact: true }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Private diagnostic");
  });

test("RSVP 401 reads use generic session-ended route", async ({ page }) => {
  await login(page, "rsvp-ended@example.com");
  await page.goto("/rsvps");
  await expect(page).toHaveURL(/\/login\?session=ended$/);
  await expect(
    page.getByText("Your admin session has ended. Please sign in again."),
  ).toBeVisible();
});

test("RSVP list and detail fit all required widths", async ({ page }) => {
  await login(page);
  for (const width of [320, 375, 412, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/rsvps",
      "/rsvps/aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", {
          name: path === "/rsvps" ? "RSVPs" : "RSVP detail",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});
