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

test("OWNER override validates, confirms, submits once, and reloads detail", async ({
  page,
}) => {
  const puts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/api\/admin\/invitations\/[^/]+\/rsvp$/.test(request.url())
    )
      puts.push(request.postData() ?? "");
  });
  await login(page);
  await page.goto("/rsvps/aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
  await page.getByRole("button", { name: "Override RSVP" }).click();
  await expect(
    page.getByText("Current guest note is read-only"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review override" }).click();
  await expect(page.getByText("Enter an override reason.")).toBeVisible();
  await page
    .getByLabel("Override reason (required)")
    .fill("Guest called the owner");
  await page.getByLabel("Declined").check();
  await page.getByRole("button", { name: "Review override" }).click();
  await expect(
    page.getByRole("dialog", { name: "Override RSVP" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Override RSVP" })
    .getByRole("button", { name: "Override RSVP" })
    .dblclick();
  await expect(page).toHaveURL(/rsvpOverridden=1/);
  await expect(page.getByText("Declined v4")).toBeVisible();
  await expect(page.getByText("Guest called the owner")).toBeVisible();
  expect(puts).toHaveLength(1);
  expect(JSON.parse(puts[0]!)).toMatchObject({
    attendees: [],
    dietaryNotes: null,
    eventSelections: [],
    expectedVersion: 3,
    overrideReason: "Guest called the owner",
    status: "DECLINED",
  });
  expect(puts[0]).not.toContain("guestNote");
  expect(puts[0]).not.toContain("adminUser");
});

test("OWNER override stale conflict preserves form values and requires reload", async ({
  page,
}) => {
  const puts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/api\/admin\/invitations\/[^/]+\/rsvp$/.test(request.url())
    )
      puts.push(request.postData() ?? "");
  });
  await login(page, "rsvp-conflict@example.com");
  await page.goto("/rsvps/aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
  await page.getByRole("button", { name: "Override RSVP" }).click();
  await page.getByLabel("Override reason (required)").fill("Stale operator note");
  await page.getByRole("button", { name: "Review override" }).click();
  await page
    .getByRole("dialog", { name: "Override RSVP" })
    .getByRole("button", { name: "Override RSVP" })
    .click();
  await expect(page.getByText("This RSVP changed elsewhere.")).toBeVisible();
  await expect(page.getByLabel("Override reason (required)")).toHaveValue(
    "Stale operator note",
  );
  await expect(page.locator(".dashboard-retry")).toHaveText(
    "Reload current RSVP detail",
  );
  expect(puts).toHaveLength(1);
});

test("OWNER override CSRF refresh and uncertain outcomes do not replay", async ({
  page,
}) => {
  const csrfPuts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/api\/admin\/invitations\/[^/]+\/rsvp$/.test(request.url())
    )
      csrfPuts.push(request.postData() ?? "");
  });
  await login(page, "rsvp-csrf@example.com");
  await page.goto("/rsvps/aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
  await page.getByRole("button", { name: "Override RSVP" }).click();
  await page.getByLabel("Override reason (required)").fill("Refresh token only");
  await page.getByRole("button", { name: "Review override" }).click();
  await page
    .getByRole("dialog", { name: "Override RSVP" })
    .getByRole("button", { name: "Override RSVP" })
    .click();
  await expect(
    page.getByText("Your session was refreshed. The RSVP override was not replayed."),
  ).toBeVisible();
  expect(csrfPuts).toHaveLength(1);

  const uncertainPuts: string[] = [];
  page.removeAllListeners("request");
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      /\/api\/admin\/invitations\/[^/]+\/rsvp$/.test(request.url())
    )
      uncertainPuts.push(request.postData() ?? "");
  });
  await page.context().clearCookies();
  await login(page, "rsvp-uncertain@example.com");
  await page.goto("/rsvps/aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
  await page.getByRole("button", { name: "Override RSVP" }).click();
  await page.getByLabel("Override reason (required)").fill("Uncertain note");
  await page.getByRole("button", { name: "Review override" }).click();
  await page
    .getByRole("dialog", { name: "Override RSVP" })
    .getByRole("button", { name: "Override RSVP" })
    .click();
  await expect(page.getByText("could not be confirmed")).toBeVisible();
  await expect(page.locator(".dashboard-retry")).toHaveText(
    "Reload current RSVP detail",
  );
  expect(uncertainPuts).toHaveLength(1);
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
