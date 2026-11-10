import { expect, test, type Page, type Response } from "@playwright/test";

const password = "synthetic test password";
const replacementPassword = "replacement test password";
const ownerOnlyMarkers = [
  "Invitation management and reporting",
  "Wedding InvitationAdmin",
  "Active Invitations",
  "Household 01",
  "RSVP Household 01",
  "Message Household 01",
  "Import CSV/XLSX",
  "OWNER RSVP override",
];
const ownerApiPaths = [
  "/api/admin/dashboard",
  "/api/admin/invitations",
  "/api/admin/rsvps",
  "/api/admin/messages",
  "/api/admin/imports",
];
let pageErrors: string[] = [];
let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors).toEqual([]);
  expect(
    consoleErrors.filter(
      (message) => !message.startsWith("Failed to load resource:"),
    ),
  ).toEqual([]);
  const storage = await page.evaluate(() => [
    localStorage.length,
    sessionStorage.length,
  ]);
  expect(storage).toEqual([0, 0]);
});

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL("http://localhost:3001/login");
}

async function gotoAllowingRedirectAbort(page: Page, path: string) {
  await page.goto(path).catch((error: unknown) => {
    if (!String(error).includes("ERR_ABORTED")) throw error;
  });
}

async function captureRouteBodies(
  page: Page,
  path: string,
  action: () => Promise<unknown>,
) {
  const bodies: string[] = [];
  const pending: Promise<void>[] = [];
  const listener = (response: Response) => {
    const url = new URL(response.url());
    if (url.origin !== "http://localhost:3001" || url.pathname !== path) return;
    if (
      response.request().resourceType() !== "document" &&
      !url.searchParams.has("_rsc")
    )
      return;
    pending.push(
      response
        .text()
        .then((body) => {
          bodies.push(body);
        })
        .catch(() => undefined),
    );
  };
  page.on("response", listener);
  try {
    await action();
    await Promise.all(pending);
  } finally {
    page.off("response", listener);
  }
  return bodies;
}

async function expectCheckinHoldingRoute(
  page: Page,
  email = "staff@example.com",
) {
  await expect(page).toHaveURL("http://localhost:3001/checkin");
  await expect(
    page.getByRole("heading", { name: "Check-in", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Event", { exact: true })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.locator("video, canvas, input[type='file']")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toHaveCount(0);
  const account = page.getByRole("navigation", { name: "Operator account" });
  await expect(account.getByRole("link")).toHaveCount(1);
  await expect(
    account.getByRole("link", { name: "Change password", exact: true }),
  ).toHaveAttribute("href", "/account/password");
  await expect(
    account.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Wedding InvitationAdmin")).toHaveCount(0);
  for (const marker of ownerOnlyMarkers)
    await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
}

test("OWNER login routes to dashboard and existing OWNER navigation remains functional", async ({
  page,
}) => {
  await signIn(page, "owner@example.com");
  await expect(page).toHaveURL("http://localhost:3001/");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await nav.getByRole("link", { name: "Invitations", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/invitations");
  await expect(
    page.getByRole("heading", {
      name: "Invitations",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Household 01");
  await nav.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
});

test("CHECKIN_STAFF login routes only to the holding route without OWNER data", async ({
  page,
}) => {
  await signIn(page, "staff@example.com");
  await expectCheckinHoldingRoute(page);
});

test("forced password-change sessions cannot bypass the password route", async ({
  page,
}) => {
  await signIn(page, "staff-change@example.com");
  await expect(page).toHaveURL("http://localhost:3001/account/password");
  await expect(
    page.getByRole("heading", { name: "Change password", exact: true }),
  ).toBeVisible();

  for (const path of ["/", "/checkin", "/invitations"]) {
    await page.goto(path);
    await expect(page).toHaveURL("http://localhost:3001/account/password");
    await expect(
      page.getByRole("heading", { name: "Change password", exact: true }),
    ).toBeVisible();
  }

  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByLabel("New password", { exact: true })
    .fill(replacementPassword);
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expectCheckinHoldingRoute(page, "staff-change@example.com");
});

test("direct OWNER-route navigation by CHECKIN_STAFF never fetches or renders OWNER data", async ({
  page,
}) => {
  const ownerApiRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (ownerApiPaths.some((ownerPath) => path.startsWith(ownerPath)))
      ownerApiRequests.push(request.url());
  });

  await signIn(page, "staff@example.com");
  await expectCheckinHoldingRoute(page);

  for (const path of [
    "/",
    "/invitations",
    "/rsvps",
    "/messages",
    "/reports",
    "/event-content",
    "/settings/staff",
  ]) {
    const bodies = await captureRouteBodies(page, path, () => page.goto(path));
    await expectCheckinHoldingRoute(page);
    const renderedText = await page.locator("body").innerText();
    for (const marker of ownerOnlyMarkers) {
      expect(renderedText).not.toContain(marker);
      expect(bodies.join("\n")).not.toContain(marker);
    }
  }
  expect(ownerApiRequests).toEqual([]);
});

test("role redirects settle without loops for OWNER, staff, and forced-change sessions", async ({
  page,
}) => {
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });

  await signIn(page, "owner@example.com");
  navigations = 0;
  await gotoAllowingRedirectAbort(page, "/checkin");
  await expect(page).toHaveURL("http://localhost:3001/checkin");
  await expect(
    page.getByRole("heading", { name: "Check-in", exact: true, level: 1 }),
  ).toBeVisible();
  expect(navigations).toBeLessThanOrEqual(3);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/login");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await signIn(page, "staff@example.com");
  navigations = 0;
  await page.reload();
  await expectCheckinHoldingRoute(page);
  expect(navigations).toBeLessThanOrEqual(3);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/login");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await signIn(page, "owner-change@example.com");
  navigations = 0;
  await page.reload();
  await expect(page).toHaveURL("http://localhost:3001/account/password");
  await expect(
    page.getByRole("heading", { name: "Change password", exact: true }),
  ).toBeVisible();
  expect(navigations).toBeLessThanOrEqual(3);
});
