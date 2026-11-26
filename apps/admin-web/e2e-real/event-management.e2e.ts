import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";
const origins = runnerOrigins();
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
const created: string[] = [];
test.beforeEach(async () => {
  fixture = await createWorkflowFixture();
});
test.afterEach(async () => {
  await fixture?.prisma.event.deleteMany({
    where: { id: { in: created.splice(0) } },
  });
  await fixture?.cleanup();
});
async function login(page: Page, staff = false) {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill(staff ? fixture.staff.email : fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    new URL(staff ? "/checkin" : "/", origins.admin).href,
  );
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
  await page.getByRole("button", { name: "New event", exact: true }).click();
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
  ).toHaveText("Event saved successfully.");
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
  ).toHaveText("Event saved successfully.");
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
      .getByRole("button", { name: "Buka Undangan", exact: true })
      .click();
    await expect(guest.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-stage",
      "content",
    );
    await expect(
      guest.getByRole("heading", { name: "11 Februari 2028", exact: true }),
    ).toBeVisible();
    await expect(guest.locator(".event-time-block time")).toHaveText("00.30");
    await expect(
      guest.getByText("Synthetic updated venue", { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("link", { name: "Buka di Google Maps", exact: true }),
    ).toHaveAttribute("href", "https://www.google.com/maps?q=synthetic");
    const seconds = guest.locator('[data-countdown-unit="seconds"]');
    const first = await seconds.textContent();
    await expect(seconds).not.toHaveText(first!);
    const downloading = guest.waitForEvent("download");
    await guest
      .getByRole("button", { name: "Tambahkan ke Kalender", exact: true })
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
    ).toHaveText("Event saved successfully.");
    await second
      .getByLabel("Venue name", { exact: true })
      .fill("Preserved editor two draft");
    await second
      .getByRole("button", { name: "Save event", exact: true })
      .click();
    await expect(
      second
        .getByRole("region", { name: "Event management editor", exact: true })
        .getByRole("alert"),
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
test("event overview uses saved readiness and round-trips between exact session workspaces", async ({
  page,
}, testInfo) => {
  const second = await fixture.prisma.event.create({
    data: {
      name: "Synthetic ceremony " + "LongWeddingSessionName".repeat(6),
      slug: `catalog-${randomUUID()}`,
      displayOrder: 2_000_000_010,
      startsAt: new Date("2028-02-10T16:30:00Z"),
      endsAt: new Date("2028-02-10T18:30:00Z"),
      address: "Synthetic address " + "LongVenueAddress".repeat(8),
      isActive: false,
    },
  });
  created.push(second.id);
  const third = await fixture.prisma.event.create({
    data: {
      name: "Third synthetic session",
      slug: `catalog-${randomUUID()}`,
      displayOrder: 2_000_000_011,
      venueName: "Another synthetic venue",
    },
  });
  created.push(third.id);
  const household = await fixture.household("Synthetic A3 confirmed household");
  await login(page);
  let assetReads = 0;
  page.on("request", (request) => {
    if (
      request.url().includes("/event-content/") &&
      request.url().includes("/assets")
    )
      assetReads++;
  });
  await page.goto(`/events?eventId=${fixture.event.id}`);
  const firstCard = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: fixture.event.name, exact: true }),
  });
  const secondCard = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: second.name, exact: true }),
  });
  const picker = page.getByLabel("Event to edit", { exact: true });
  const navigation = page.getByRole("navigation", {
    name: "Selected event workflows",
  });
  await expect(picker).toHaveValue(fixture.event.id);
  await expect(firstCard).toContainText("RSVP confirmed people");
  await expect(firstCard.locator("dd").filter({ hasText: /^1$/ })).toHaveCount(
    3,
  );
  await expect(secondCard).toContainText("Inactive");
  await expect(secondCard).toContainText("23:30");
  await expect(secondCard).toContainText("01:30");
  await expect(page.getByRole("heading", { name: third.name })).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: third.name, exact: true }),
    }),
  ).toContainText("Another synthetic venue");
  for (const width of [320, 375, 412, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (width === 320 || width === 1280)
      await page.screenshot({
        path: testInfo.outputPath(`events-after-${width}.png`),
        fullPage: true,
      });
  }
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await page.setViewportSize({ width: 412, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(412);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(assetReads).toBe(0);
  await navigation
    .getByRole("link", {
      name: "View active eligible households, including walk-ins",
    })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `/invitations\\?status=ACTIVE&eligibility=includes&eventId=${fixture.event.id}$`,
    ),
  );
  await expect(page.getByText(household.name, { exact: true })).toBeVisible();
  await page.goBack();
  await expect(picker).toHaveValue(fixture.event.id);
  await navigation
    .getByRole("link", { name: "View RSVP responses referencing this event" })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/rsvps\\?eventId=${fixture.event.id}$`),
  );
  await expect(page.getByText(household.name, { exact: true })).toBeVisible();
  await page.goBack();
  await expect(picker).toHaveValue(fixture.event.id);
  await page
    .getByLabel("Venue name", { exact: true })
    .fill("Keep this local draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await picker.selectOption(second.id);
  await expect(picker).toHaveValue(fixture.event.id);
  page.once("dialog", (dialog) => dialog.dismiss());
  await navigation
    .getByRole("link", { name: "Manage event materials" })
    .click({ noWaitAfter: true });
  await expect(page.getByLabel("Venue name", { exact: true })).toHaveValue(
    "Keep this local draft",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await picker.selectOption(second.id);
  await expect(
    page.getByRole("region", { name: "Configuration readiness" }),
  ).toContainText("Venue · Missing");
  const materialAction = navigation.getByRole("link", {
    name: "Manage event materials",
  });
  await materialAction.focus();
  await expect(materialAction).toBeFocused();
  await materialAction.press("Enter");
  const materialPicker = page.getByLabel("Event", { exact: true });
  await expect(materialPicker).toHaveValue(second.id);
  await page.reload();
  await expect(materialPicker).toHaveValue(second.id);
  const back = page.getByRole("link", { name: "Back to event configuration" });
  await page.getByLabel("Include parking guide", { exact: true }).check();
  await expect(materialPicker).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await back.click({ noWaitAfter: true });
  await expect(
    page.getByLabel("Include parking guide", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Include parking guide", { exact: true }).uncheck();
  await back.click();
  await expect(picker).toHaveValue(second.id);
  await page.goBack();
  await expect(materialPicker).toHaveValue(second.id);
  await page.goForward();
  await expect(picker).toHaveValue(second.id);
  await page.goto("/event-content?eventId=invalid");
  await expect(
    page.getByText("Requested event is invalid or no longer available.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(materialPicker).toHaveValue("");
  await page.goto(`/events?eventId=${randomUUID()}`);
  await expect(
    page.getByText("Requested event is invalid or no longer available.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveCount(0);
});
test("an uncertain create stays locked and reload selects the saved slug without replay", async ({
  page,
}) => {
  await editor(page);
  await page.getByRole("button", { name: "New event", exact: true }).click();
  const slug = `uncertain-create-${randomUUID()}`;
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Synthetic uncertain create");
  await page.getByLabel("Slug", { exact: true }).fill(slug);
  const committed = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let writes = 0;
  await page.route("**/api/admin/event-management", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    created.push((await response.json()).id);
    committed.resolve();
    await release.promise;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  try {
    await committed.promise;
    await expect(page.getByLabel("Event name", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "New event", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("link", { name: "Event materials", exact: true })
      .click();
    await expect(page).toHaveURL(new URL("/events", origins.admin).href);
  } finally {
    release.resolve();
  }
  await expect(
    page.getByText("Save outcome is unknown.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save event", exact: true }),
  ).toBeDisabled();
  const dialogs: string[] = [];
  const dismiss = (dialog: import("@playwright/test").Dialog) => {
    dialogs.push(dialog.type());
    return dialog.dismiss();
  };
  page.on("dialog", dismiss);
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Events", exact: true })
    .press("Enter");
  await expect(
    page.getByText(
      "Finish the current action or reload saved events before leaving.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New event", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Slug", { exact: true })).toHaveValue(slug);
  expect(dialogs).toEqual([]);
  page.off("dialog", dismiss);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Reload saved events", exact: true })
    .click();
  await expect(page.getByLabel("Event to edit", { exact: true })).toHaveValue(
    created[0]!,
  );
  await expect(
    page.getByText("An event with that slug exists.", { exact: false }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(await fixture.prisma.event.count({ where: { slug } })).toBe(1);
});

test("rejected sign-out keeps the Events draft and successful retry ends the session", async ({
  page,
}) => {
  await editor(page);
  const before = await fixture.prisma.event.findUniqueOrThrow({
    where: { id: fixture.event.id },
  });
  const eventName = page.getByLabel("Event name", { exact: true });
  const start = page.getByLabel("Start (WIB)", { exact: true });
  await eventName.fill("Synthetic draft survives sign-out rejection");
  await start.fill("2027-01-02T18:30");
  let logoutRequests = 0;
  const logoutPath = "**/api/admin/auth/logout";
  await page.route(logoutPath, async (route) => {
    logoutRequests++;
    if (logoutRequests > 1) return route.continue();
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        "x-csrf-token": "synthetic-invalid",
      },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe("CSRF_INVALID");
    await route.fulfill({ response });
  });
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  await signOut.click();
  await expect(page.getByText(/Your session has been refreshed/)).toBeVisible();
  expect((await page.request.get("/api/admin/auth/me")).status()).toBe(200);
  await expect(eventName).toHaveValue(
    "Synthetic draft survives sign-out rejection",
  );
  await expect(start).toHaveValue("2027-01-02T18:30");
  await expect(page.getByLabel("Event to edit", { exact: true })).toHaveValue(
    fixture.event.id,
  );
  await expect(
    page.getByRole("button", { name: "Save event", exact: true }),
  ).toBeEnabled();
  await signOut.click();
  await expect(page).toHaveURL(new URL("/login", origins.admin).href);
  expect((await page.request.get("/api/admin/auth/me")).status()).toBe(401);
  expect(logoutRequests).toBe(2);
  expect(
    await fixture.prisma.event.findUniqueOrThrow({
      where: { id: fixture.event.id },
    }),
  ).toEqual(before);
});

test("published materials remain stored but hidden when an event is inactive", async ({
  page,
}) => {
  const guest = await fixture.household("Synthetic publication household", {
    pending: true,
  });
  const parking = {
    title: "Synthetic parking",
    instructions: ["Use the marked entrance"],
    mapAssetId: null,
    mapAlt: "",
    pdfAssetId: null,
    googleMapsUrl: null,
  };
  const rundown = {
    title: "Synthetic programme",
    items: [
      { startsAt: "2027-01-02T10:00:00Z", title: "Arrival", description: "" },
    ],
  };
  const draft = {
    parking: { ...parking, title: "Unsaved to public" },
    rundown,
  };
  await fixture.prisma.eventContent.create({
    data: {
      eventId: fixture.event.id,
      draft,
      published: { parking, rundown },
      publishedAt: new Date(),
    },
  });
  const publicPath = `${origins.api}/api/public/invitations/${guest.publicCredential}/venue-content`;
  const publicRead = async () => {
    const response = await page.request.get(publicPath);
    expect(response.status()).toBe(200);
    return response.json();
  };
  expect((await publicRead()).items).toMatchObject([
    { content: { parking, rundown } },
  ]);
  await fixture.prisma.event.update({
    where: { id: fixture.event.id },
    data: { isActive: false },
  });
  expect((await publicRead()).items).toEqual([]);
  await editor(page);
  const readiness = page.getByRole("region", {
    name: "Configuration readiness",
  });
  await expect(readiness).toContainText(
    "Published snapshot retained · draft differs · hidden from guests",
  );
  await expect(readiness).toContainText(
    "Guests cannot view materials for this inactive event.",
  );
  await page.getByRole("link", { name: "Manage event materials" }).click();
  await expect(
    page.getByText("Guests cannot view materials for this inactive event.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to event configuration" }).click();
  await page.getByLabel("Active event", { exact: true }).check();
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(readiness).toContainText(
    "available to eligible guests with valid invitation access",
  );
  expect((await publicRead()).items).toMatchObject([
    { content: { parking, rundown } },
  ]);
  const saved = await fixture.prisma.eventContent.findUniqueOrThrow({
    where: { eventId: fixture.event.id },
  });
  expect(saved.published).toEqual({ parking, rundown });
  expect(saved.draft).toEqual(draft);
  expect(saved.version).toBe(1);
});
test("unhydrated and delayed editors cannot submit or switch the requested event", async ({
  page,
}) => {
  await login(page);
  const scripts = /\/_next\/static\/[^?]+\.js(?:\?|$)/;
  const hydration = Promise.withResolvers<void>();
  const intercepted = Promise.withResolvers<void>();
  const holdScript = async (route: Route) => {
    intercepted.resolve();
    await hydration.promise;
    await route.continue();
  };
  await page.route(scripts, holdScript);
  try {
    await page.goto(`/events?eventId=${fixture.event.id}`, {
      waitUntil: "commit",
    });
    await intercepted.promise;
    await expect(
      page.getByRole("button", { name: "New event", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Reload saved events", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Save event", exact: true }),
    ).toHaveCount(0);
  } finally {
    hydration.resolve();
    await page.waitForLoadState("load");
    await page.unroute(scripts, holdScript);
  }
  await expect(page.getByLabel("Event to edit", { exact: true })).toHaveValue(
    fixture.event.id,
  );
  const responseGate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  await page.route(
    `**/api/admin/event-content/${fixture.event.id}`,
    async (route) => {
      const response = await route.fetch();
      started.resolve();
      await responseGate.promise;
      await route.fulfill({ response });
    },
  );
  await page.getByRole("link", { name: "Manage event materials" }).click();
  const picker = page.getByLabel("Event", { exact: true });
  try {
    await started.promise;
    await expect(picker).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Save draft", exact: true }),
    ).toHaveCount(0);
  } finally {
    responseGate.resolve();
  }
  await expect(picker).toHaveValue(fixture.event.id);
  await expect(
    page.getByRole("link", { name: "Back to event configuration" }),
  ).toHaveAttribute("href", `/events?eventId=${fixture.event.id}`);
});

test("empty and unavailable catalogs remain distinguishable", async ({
  page,
}) => {
  await login(page);
  const catalog = "**/api/admin/event-management";
  await page.route(catalog, (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/events");
  await expect(
    page.getByText("No saved events.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New event", exact: true }),
  ).toBeEnabled();
  await page.unroute(catalog);
  await page.route(catalog, (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Event management editor" })
      .getByRole("alert"),
  ).toContainText("Saved state could not be loaded.");
  await expect(
    page.getByText("No saved events.", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New event", exact: true }),
  ).toBeDisabled();
  await page.unroute(catalog);
  await page
    .getByRole("button", { name: "Reload saved events", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: fixture.event.name, exact: true }),
  ).toBeVisible();
});
