import { expect, test, type Page } from "@playwright/test";
import { events } from "../tests/invitation-fixtures";
async function login(page: Page, email = "list-owner@example.com") {
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
async function form(page: Page, email = "create-owner@example.com") {
  await login(page, email);
  await page.goto("/invitations/new");
  await expect(page.getByLabel("Display name (required)")).toBeVisible();
  await page
    .getByLabel("Display name (required)")
    .fill("  New sample household  ");
  await page
    .getByLabel("Full name (required)", { exact: true })
    .fill("Sample guest");
  await page.getByLabel("Reception", { exact: true }).check();
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
test("list fields, URL search/filter/sort/page state, refresh and back", async ({
  page,
}) => {
  await login(page);
  await page.goto("/invitations");
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(25);
  await expect(
    page.getByRole("rowheader", {
      name: "Household 01 Greeting 1",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Archived");
  await expect(page.getByRole("table")).toContainText("Accepted");
  await expect(page.getByRole("table")).toContainText("Declined");
  await page
    .getByLabel("Search invitations", { exact: true })
    .fill("  Household  ");
  await page
    .getByLabel("Invitation status", { exact: true })
    .selectOption("ACTIVE");
  await page.getByLabel("RSVP status", { exact: true }).selectOption("PENDING");
  await page.getByLabel("Sort by", { exact: true }).selectOption("displayName");
  await page.getByLabel("Sort direction").selectOption("asc");
  await page.getByLabel("Per page").fill("2");
  await page.getByRole("button", { name: "Apply search and filters" }).click();
  await expect(page).toHaveURL(/search=Household/);
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(new URL(page.url()).searchParams.get("status")).toBe("ACTIVE");
  expect(new URL(page.url()).searchParams.get("rsvpStatus")).toBe("PENDING");
  await page.reload();
  await expect(
    page.getByLabel("Search invitations", { exact: true }),
  ).toHaveValue("Household");
  await page.goBack();
  await expect(page).toHaveURL(/page=1/);
  await page.getByRole("link", { name: "Reset all" }).click();
  await expect(page).toHaveURL(/\/invitations$/);
  await expect(
    page.getByLabel("Invitation status", { exact: true }),
  ).toHaveValue("");
});
test("empty, no matches, beyond last and invalid URL are distinct", async ({
  page,
}) => {
  await login(page, "list-empty@example.com");
  await page.goto("/invitations");
  await expect(
    page.getByRole("heading", { name: "No invitations yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Invitation pagination" }),
  ).toContainText("0 pages");
  await page.goto("/invitations?search=absent");
  await expect(
    page.getByRole("heading", { name: "No matching invitations" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Clear search and filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No invitations yet" }),
  ).toBeVisible();
  await page.goto("/invitations?status=invalid");
  await expect(
    page.getByRole("heading", { name: "Invalid search or filters" }),
  ).toBeVisible();
});
test("valid beyond-final page preserves truthful totals and recovery", async ({
  page,
}) => {
  await login(page);
  await page.goto("/invitations?page=99");
  await expect(
    page.getByRole("heading", { name: "No invitations on this page" }),
  ).toBeVisible();
  await expect(page.getByText("27 invitations in total")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Invitation pagination" }),
  ).toContainText("Page 99 · 2 pages");
  await page.getByRole("link", { name: "First page", exact: true }).click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(25);
});
for (const [email, title] of [
  ["list-error@example.com", "Unable to load invitations"],
  ["list-forbidden@example.com", "Invitation access unavailable"],
  ["list-malformed@example.com", "Unable to load invitations"],
])
  test(`bounded list/event failure ${email}`, async ({ page }) => {
    await login(page, email);
    for (const path of ["/invitations", "/invitations/new"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: title!, exact: true }),
      ).toBeVisible();
      await expect(page.locator("body")).not.toContainText(
        "Private diagnostic",
      );
    }
  });
test("401 reads use generic session-ended route", async ({ page }) => {
  await login(page, "list-ended@example.com");
  await page.goto("/invitations");
  await expect(page).toHaveURL(/\/login\?session=ended$/);
  await expect(
    page.getByText("Your admin session has ended. Please sign in again."),
  ).toBeVisible();
});
test("no active events blocks creation", async ({ page }) => {
  await login(page, "no-events@example.com");
  await page.goto("/invitations/new");
  await expect(
    page.getByRole("heading", { name: "No active events available" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create invitation", exact: true }),
  ).toHaveCount(0);
});

test("loading announces list and event reads without fake rows or an incomplete form", async ({
  page,
}) => {
  await login(page, "list-slow@example.com");
  await page.goto("/invitations", { waitUntil: "commit" });
  await expect(
    page.getByText("Loading invitations…", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(25);
  await page.goto("/invitations/new", { waitUntil: "commit" });
  await expect(
    page.getByText("Loading event options…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create invitation", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create invitation", exact: true }),
  ).toBeVisible();
});
test("create exact body, event order, duplicate names, double-submit and fresh success list", async ({
  page,
}) => {
  await form(page, "create-success@example.com");
  await expect(page.getByLabel("Old event (inactive)")).toBeDisabled();
  await page
    .getByLabel("Greeting name", { exact: true })
    .fill("  Dear guests ");
  await page.getByLabel("Maximum additional children (required)").fill("2");
  await page
    .getByLabel("RSVP deadline", { exact: true })
    .fill("2026-12-25T23:59:59");
  await page.getByLabel("Internal notes").fill(" private note ");
  await page.getByLabel("Allow one plus-one guest").check();
  await page.getByRole("button", { name: "Add invitee", exact: true }).click();
  await expect(page.locator("#invitee-1")).toBeFocused();
  await page.locator("#invitee-1").fill("Sample guest");
  await page.locator("#category-1").selectOption("CHILD");
  let posts = 0;
  let payload: unknown;
  let secure = false;
  await page.route("**/api/admin/invitations", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts++;
    payload = route.request().postDataJSON();
    const headers = await route.request().allHeaders();
    secure =
      Boolean(headers["x-csrf-token"]) &&
      headers.origin === "http://localhost:3001" &&
      Boolean(headers.cookie) &&
      !headers["idempotency-key"];
    await route.fulfill({ response: await route.fetch() });
  });
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByRole("button", { name: "Creating…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Creating invitation… Please wait."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/invitations\?created=1$/);
  expect(posts).toBe(1);
  expect(secure).toBe(true);
  expect(payload).toEqual({
    displayName: "New sample household",
    greetingName: "Dear guests",
    allowPlusOne: true,
    maxAdditionalChildren: 2,
    rsvpDeadlineAt: "2026-12-25T16:59:59.000Z",
    notes: "private note",
    eventIds: [events[0]!.id],
    invitees: [
      { fullName: "Sample guest", category: "ADULT", label: null },
      { fullName: "Sample guest", category: "CHILD", label: null },
    ],
  });
  await expect(
    page.getByRole("rowheader", { name: "New sample household Dear guests" }),
  ).toHaveCount(1);
  await expect(page.getByText("Invitation created.")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await expect(page.locator("body")).not.toContainText("synthetic-create-only");
});
test("client validation focuses errors without POST, dynamic remove retains rows", async ({
  page,
}) => {
  await login(page);
  await page.goto("/invitations/new");
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/admin/invitations"))
      posts++;
  });
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.getByLabel("Display name (required)")).toBeFocused();
  await expect(
    page.getByText("Select at least one active event."),
  ).toBeVisible();
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "Add invitee", exact: true }).click();
  await page.locator("#invitee-1").fill("Keep guest");
  await page
    .getByRole("button", { name: "Remove invitee 1", exact: true })
    .click();
  await expect(page.locator("#invitee-0")).toHaveValue("Keep guest");
});
for (const [status, code, copy] of [
  [400, "VALIDATION_ERROR", "The invitation was not accepted."],
  [403, "FORBIDDEN", "You are not authorized"],
  [409, "CONFLICT", "current data conflicts"],
] as const)
  test(`known rejection ${status} preserves form and permits explicit submit`, async ({
    page,
  }) => {
    await form(page);
    let posts = 0;
    await page.route("**/api/admin/invitations", (route) => {
      posts++;
      return route.fulfill({
        status,
        json: { error: { code, message: "private diagnostic", details: null } },
      });
    });
    await page
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    await expect(
      page.getByRole("form", { name: "Create invitation" }).getByRole("alert"),
    ).toContainText(copy);
    await expect(page.getByLabel("Display name (required)")).toHaveValue(
      "  New sample household  ",
    );
    await expect(
      page.getByRole("button", { name: "Create invitation", exact: true }),
    ).toBeEnabled();
    expect(posts).toBe(1);
    await expect(page.locator("body")).not.toContainText("private diagnostic");
  });
for (const mode of ["network", "500", "malformed"] as const)
  test(`uncertain ${mode} locks POST and directs fresh list read`, async ({
    page,
  }) => {
    await form(page);
    let posts = 0;
    await page.route("**/api/admin/invitations", (route) => {
      posts++;
      return mode === "network"
        ? route.abort("connectionreset")
        : route.fulfill({ status: mode === "500" ? 500 : 201, json: {} });
    });
    await page
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    await expect(
      page.getByRole("form", { name: "Create invitation" }).getByRole("alert"),
    ).toContainText("could not be confirmed");
    await expect(
      page.getByRole("button", { name: "Create invitation", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("form", { name: "Create invitation" })
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    expect(posts).toBe(1);
    await page.getByRole("link", { name: "Check invitations list" }).click();
    await expect(page.getByRole("table")).toBeVisible();
  });
test("create 401 redirects; CSRF recovery never replays POST", async ({
  page,
}) => {
  await form(page);
  let posts = 0,
    reads = 0;
  await page.route("**/api/admin/auth/me", async (route) => {
    reads++;
    await route.continue();
  });
  await page.route("**/api/admin/invitations", (route) => {
    posts++;
    return route.fulfill({
      status: 403,
      json: { error: { code: "CSRF_INVALID" } },
    });
  });
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "Create invitation" }).getByRole("alert"),
  ).toContainText("Your session was refreshed");
  expect(posts).toBe(1);
  expect(reads).toBe(1);
  await page.unroute("**/api/admin/invitations");
  await page.route("**/api/admin/invitations", async (route) => {
    await page.context().clearCookies();
    await route.fulfill({
      status: 401,
      json: { error: { code: "UNAUTHENTICATED" } },
    });
  });
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?session=ended$/);
});
test("list and dynamic create fit all required widths; keyboard controls work", async ({
  page,
}) => {
  await login(page);
  for (const width of [320, 375, 412, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/invitations", "/invitations/new"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", {
          name: path.endsWith("new") ? "New invitation" : "Invitations",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      if (path.endsWith("new")) {
        await page
          .getByRole("button", { name: "Add invitee", exact: true })
          .click();
        await expect(page.locator("#invitee-1")).toBeFocused();
      } else {
        await expect(
          page.getByRole("region", { name: "Invitations table" }),
        ).toBeVisible();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});
