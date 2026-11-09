import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
const created: string[] = [];
test.beforeAll(async () => {
  fixture = await createWorkflowFixture();
});
test.afterAll(async () => {
  await fixture?.prisma.event.deleteMany({ where: { id: { in: created } } });
  await fixture?.cleanup();
});
async function login(page: Page, staff = false) {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(staff ? fixture.staff.email : fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}
async function editor(page: Page) {
  await login(page);
  await page.goto("/events");
  await expect(
    page
      .getByRole("region", { name: "Event management editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Saved events loaded.");
  await page
    .getByLabel("Event to edit", { exact: true })
    .selectOption(fixture.event.id);
}
test("OWNER creates an event and edits linked details; guest date, countdown, calendar and venue agree with saved WIB data", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.goto("/events");
  await expect(
    page
      .getByRole("region", { name: "Event management editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Saved events loaded.");
  const slug = `browser-${randomUUID()}`;
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Synthetic additional event");
  await page.getByLabel("Slug", { exact: true }).fill(slug);
  await page.getByLabel("Active event", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Event management editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Event saved.");
  const extra = await fixture.prisma.event.findUniqueOrThrow({
    where: { slug },
  });
  created.push(extra.id);
  expect(extra.isActive).toBe(false);
  expect(extra.startsAt).toBeNull();
  const household = await fixture.household("Synthetic event guest", {
    pending: true,
  });
  await page
    .getByRole("button", { name: "Reload saved events", exact: true })
    .click();
  await page
    .getByLabel("Event to edit", { exact: true })
    .selectOption(fixture.event.id);
  await expect(page.getByLabel("Slug", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Active event", { exact: true })).toBeDisabled();
  await page
    .getByLabel("Start (WIB)", { exact: true })
    .fill("2028-02-11T00:30");
  await page.getByLabel("End (WIB)", { exact: true }).fill("2028-02-11T02:30");
  await page
    .getByLabel("Venue name", { exact: true })
    .fill("Synthetic updated venue");
  await page
    .getByLabel("Google Maps URL", { exact: true })
    .fill("https://www.google.com/maps?q=synthetic");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Event management editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Event saved.");
  expect(
    (
      await fixture.prisma.event.findUniqueOrThrow({
        where: { id: fixture.event.id },
      })
    ).startsAt?.toISOString(),
  ).toBe("2028-02-10T17:30:00.000Z");
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Event management editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Saved events loaded.");
  await page
    .getByLabel("Event to edit", { exact: true })
    .selectOption(fixture.event.id);
  await expect(page.getByLabel("Start (WIB)", { exact: true })).toHaveValue(
    "2028-02-11T00:30",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../../.local-daily/events-editor-mobile.png",
    fullPage: true,
  });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  try {
    const guest = await context.newPage();
    await guest.goto(
      `${process.env.PUBLIC_INVITATION_BASE_URL}/i/${household.publicCredential}`,
    );
    await guest
      .getByRole("button", { name: "Open invitation", exact: true })
      .click();
    await expect(guest.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-stage",
      "content",
    );
    await expect(
      guest.getByRole("heading", { name: "11 February 2028", exact: true }),
    ).toBeVisible();
    await expect(guest.locator(".event-time-block time")).toHaveText("00.30");
    await expect(
      guest.getByText("Synthetic updated venue", { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("link", { name: "View in Google Maps", exact: true }),
    ).toHaveAttribute("href", "https://www.google.com/maps?q=synthetic");
    const seconds = guest.locator('[data-countdown-unit="seconds"]');
    const first = await seconds.textContent();
    await expect(seconds).not.toHaveText(first!);
    const downloading = guest.waitForEvent("download");
    await guest
      .getByRole("button", { name: "Add to calendar", exact: true })
      .click();
    const download = await downloading;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toContain(
      "DTSTART:20280210T173000Z",
    );
  } finally {
    await context.close();
  }
});
test("two OWNER editors preserve stale draft and require explicit saved-state reload", async ({
  page,
  browser,
}) => {
  await editor(page);
  const context = await browser.newContext();
  try {
    const second = await context.newPage();
    await editor(second);
    await page
      .getByLabel("Venue name", { exact: true })
      .fill("Editor one venue");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Event management editor", exact: true })
        .getByRole("status"),
    ).toHaveText("Event saved.");
    await second
      .getByLabel("Venue name", { exact: true })
      .fill("Preserved editor two draft");
    await second
      .getByRole("button", { name: "Save event", exact: true })
      .click();
    await expect(
      second
        .getByRole("region", { name: "Event management editor", exact: true })
        .getByRole("status"),
    ).toContainText("Another editor changed this event");
    await expect(second.getByLabel("Venue name", { exact: true })).toHaveValue(
      "Preserved editor two draft",
    );
    await expect(
      second.getByRole("button", { name: "Save event", exact: true }),
    ).toBeDisabled();
    second.once("dialog", (d) => d.accept());
    await second
      .getByRole("button", { name: "Reload saved events", exact: true })
      .click();
    await expect(second.getByLabel("Venue name", { exact: true })).toHaveValue(
      "Editor one venue",
    );
  } finally {
    await context.close();
  }
});
test("lost save response is not replayed; canonical reload recovers exactly one mutation", async ({
  page,
}) => {
  await editor(page);
  const before = await fixture.prisma.event.findUniqueOrThrow({
    where: { id: fixture.event.id },
  });
  let requests = 0;
  await page.route(
    `**/api/admin/event-management/${fixture.event.id}`,
    async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      requests++;
      await route.fetch();
      await route.abort("failed");
    },
  );
  await page
    .getByLabel("Venue name", { exact: true })
    .fill("Saved despite response loss");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Event management editor", exact: true })
      .getByRole("status"),
  ).toContainText("Save outcome is unknown");
  await expect(
    page.getByRole("button", { name: "Save event", exact: true }),
  ).toBeDisabled();
  expect(requests).toBe(1);
  const after = await fixture.prisma.event.findUniqueOrThrow({
    where: { id: fixture.event.id },
  });
  expect(after.version).toBe(before.version + 1);
  expect(after.venueName).toBe("Saved despite response loss");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Reload saved events", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Event management editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Saved events loaded.");
  await expect(page.getByLabel("Venue name", { exact: true })).toHaveValue(
    "Saved despite response loss",
  );
  expect(requests).toBe(1);
});
test("staff cannot open the OWNER editor or its API; schedule locks after staff check-in", async ({
  page,
  browser,
}) => {
  const household = await fixture.household("Synthetic schedule lock");
  await login(page, true);
  const sessionResponse = await page.request.get("/api/admin/auth/me");
  const session = await sessionResponse.json();
  const confirm = await page.request.post("/api/admin/checkin/manual-confirm", {
    headers: {
      "X-CSRF-Token": session.csrfToken,
      Origin: process.env.ADMIN_ORIGIN!,
    },
    data: {
      invitationId: household.id,
      eventId: fixture.event.id,
      attendeeCount: 1,
    },
  });
  expect(confirm.status()).toBe(201);
  expect((await page.request.get("/api/admin/event-management")).status()).toBe(
    403,
  );
  await page.goto("/events");
  await expect(page).toHaveURL(/\/checkin$/);
  const context = await browser.newContext();
  try {
    const owner = await context.newPage();
    await editor(owner);
    await expect(
      owner.getByLabel("Start (WIB)", { exact: true }),
    ).toBeDisabled();
    await expect(owner.getByLabel("End (WIB)", { exact: true })).toBeDisabled();
  } finally {
    await context.close();
  }
});
