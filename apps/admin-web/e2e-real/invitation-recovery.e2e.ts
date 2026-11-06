import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";

let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
const names = ["Synthetic Recovery Guest", "Synthetic Lost Response Guest"];
const evidence = resolve(
  process.cwd(),
  "../../.local-daily/p0-production-recovery-20261106",
);
test.beforeAll(async () => {
  fixture = await createWorkflowFixture();
  expect(await fixture.prisma.event.count()).toBe(1);
  await mkdir(evidence, { recursive: true });
});
test.afterAll(async () => {
  if (!fixture) return;
  // Fixture checks local host, explicit opt-in and QA database identity first.
  // Delete only this test's graphs; never production or another household.
  const rows = await fixture.prisma.invitation.findMany({
    where: { displayName: { in: names } },
    select: { id: true },
  });
  const where = { invitationId: { in: rows.map((row) => row.id) } };
  await fixture.prisma.checkinPass.deleteMany({ where });
  await fixture.prisma.rSVP.deleteMany({ where });
  await fixture.prisma.invitee.deleteMany({ where });
  await fixture.prisma.invitationEvent.deleteMany({ where });
  await fixture.prisma.invitation.deleteMany({
    where: { id: { in: rows.map((row) => row.id) } },
  });
  await fixture.cleanup();
});
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}
async function fits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("real OWNER creates one invitation, copies/shares its link, guest opens and RSVP survives reload at desktop/mobile widths", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("admin pageerror"));
  const eventBefore = await fixture.prisma.event.findUniqueOrThrow({
    where: { id: fixture.event.id },
  });
  await login(page);
  await page.getByRole("link", { name: "Invitations", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No invitations yet" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Create invitation", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Wedding event" }),
  ).toContainText(fixture.event.name);
  await expect(
    page.getByRole("checkbox", { name: fixture.event.name }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.locator("#invitee-0")).toBeFocused();
  expect(await fixture.prisma.invitation.count()).toBe(0);
  await page.locator("#invitee-0").fill(names[0]!);
  for (const width of [320, 375, 412, 1280]) {
    await fits(page, width);
    await page
      .getByRole("button", { name: "Create invitation", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Create invitation", exact: true }),
    ).toBeInViewport();
    await page.locator("#main-content").screenshot({
      path: resolve(evidence, `isolated-after-admin-${width}.png`),
    });
  }
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/admin/invitations"
    )
      posts++;
  });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/admin/invitations",
  );
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  expect((await responsePromise).status()).toBe(201);
  await expect(
    page.getByRole("heading", { name: "Invitation created", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  const rows = await fixture.prisma.invitation.findMany({
    include: { invitationEvents: true, invitees: true },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]!.displayName).toBe(names[0]);
  expect(rows[0]!.invitationEvents.map((row) => row.eventId)).toEqual([
    fixture.event.id,
  ]);
  expect(rows[0]!.invitees).toHaveLength(1);
  const publicUrl = await page
    .getByLabel("Public invitation link")
    .inputValue();
  expect(
    new URL(publicUrl).origin === "http://localhost:3100" &&
      /^\/i\/[\w-]{43}$/.test(new URL(publicUrl).pathname),
  ).toBe(true);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy Link", exact: true }).click();
  expect(
    await page.evaluate(
      (url) => navigator.clipboard.readText().then((text) => text === url),
      publicUrl,
    ),
  ).toBe(true);
  const share = await page
    .getByRole("link", { name: "Share on WhatsApp" })
    .getAttribute("href");
  expect(
    new URL(share!).origin === "https://wa.me" &&
      new URL(share!).searchParams.get("text")!.endsWith(publicUrl),
  ).toBe(true);
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  // Never capture bearer URLs, QR payloads or authenticated email in evidence.
  await page.locator(".invitation-created").screenshot({
    path: resolve(evidence, "isolated-after-success.png"),
    mask: [page.locator(".invitation-share")],
  });
  const guestContext = await browser.newContext({ reducedMotion: "reduce" });
  const guest = await guestContext.newPage();
  guest.on("pageerror", () => errors.push("guest pageerror"));
  try {
    await guest.goto(publicUrl);
    await guest
      .getByRole("button", { name: "Open invitation", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "View invitation", exact: true })
      .click();
    await expect(guest.locator("#invitation-title")).toHaveText(names[0]!);
    await expect(guest.getByRole("form", { name: "Your RSVP" })).toBeVisible();
    await expect(
      guest.getByRole("checkbox", { name: fixture.event.name, exact: true }),
    ).toBeVisible();
    for (const width of [320, 375, 412, 1280]) {
      await fits(guest, width);
      await guest
        .getByRole("button", { name: "Send RSVP", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        guest.getByRole("button", { name: "Send RSVP", exact: true }),
      ).toBeInViewport();
      await guest.screenshot({
        path: resolve(evidence, `isolated-public-${width}.png`),
      });
    }
    await guest.getByRole("radio", { name: "Joyfully Accept" }).check();
    await guest.getByRole("checkbox", { name: names[0]!, exact: true }).check();
    await guest
      .getByRole("checkbox", { name: fixture.event.name, exact: true })
      .check();
    await guest.getByLabel(`Guests attending ${fixture.event.name}`).fill("1");
    await guest.getByRole("button", { name: "Send RSVP", exact: true }).click();
    await expect(guest.locator(".checkin-code")).toBeVisible();
    const stored = await fixture.prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: rows[0]!.id },
      include: { attendees: true, eventSelections: true },
    });
    expect(stored.status).toBe("ACCEPTED");
    expect(stored.attendees).toHaveLength(1);
    expect(stored.eventSelections[0]!.eventId).toBe(fixture.event.id);
    await guest.reload();
    await guest
      .getByRole("button", { name: "Open invitation", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "View invitation", exact: true })
      .click();
    await expect(
      guest.getByRole("radio", { name: "Joyfully Accept" }),
    ).toBeChecked();
    await expect(
      guest.getByRole("checkbox", { name: names[0]!, exact: true }),
    ).toBeChecked();
    expect(
      (
        await fixture.prisma.rSVP.findUniqueOrThrow({
          where: { invitationId: rows[0]!.id },
        })
      ).version,
    ).toBe(stored.version);
  } finally {
    await guestContext.close();
  }
  expect(
    await fixture.prisma.event.findUniqueOrThrow({
      where: { id: fixture.event.id },
    }),
  ).toEqual(eventBefore);
  expect(await fixture.prisma.event.count()).toBe(1);
  expect(await fixture.prisma.invitation.count()).toBe(1);
  expect(errors).toEqual([]);
});

test("committed create with lost response stays locked across reload and never replays", async ({
  page,
}) => {
  await login(page);
  await page.goto("/invitations/new");
  await page.locator("#invitee-0").fill(names[1]!);
  const before = await fixture.prisma.invitation.count();
  let posts = 0;
  await page.route("**/api/admin/invitations", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "Create invitation" }).getByRole("alert"),
  ).toContainText("could not be confirmed");
  expect(await fixture.prisma.invitation.count()).toBe(before + 1);
  await page.reload();
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
  expect(await page.evaluate(() => Object.entries(sessionStorage))).toEqual([
    ["invitation-create-pending", "pending"],
  ]);
  await page.goto("/invitations");
  await expect(
    page.getByRole("link", { name: names[1]!, exact: true }),
  ).toBeVisible();
  expect(await fixture.prisma.invitation.count()).toBe(before + 1);
});
