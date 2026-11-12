import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";
const origins = runnerOrigins();
let f: Awaited<ReturnType<typeof createWorkflowFixture>>,
  manager: { id: string; email: string };
const ids: string[] = [];
test.beforeAll(async () => {
  f = await createWorkflowFixture();
  const owner = await f.prisma.adminUser.findUniqueOrThrow({
    where: { id: f.owner.id },
  });
  manager = await f.prisma.adminUser.create({
    data: {
      email: `guest-manager-${f.owner.id}@example.test`,
      role: "GUEST_MANAGER",
      passwordHash: owner.passwordHash,
    },
  });
});
test.afterAll(async () => {
  if (!f) return;
  await f.prisma.checkinRecord.deleteMany({
    where: { invitationId: { in: ids } },
  });
  await f.prisma.checkinPass.deleteMany({
    where: { invitationId: { in: ids } },
  });
  await f.prisma.rSVP.deleteMany({ where: { invitationId: { in: ids } } });
  await f.prisma.adminSession.deleteMany({
    where: { adminUserId: manager.id },
  });
  await f.prisma.adminUser.delete({ where: { id: manager.id } });
  await f.cleanup();
});
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(manager.email);
  await page.getByLabel("Password", { exact: true }).fill(f.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL("/reception", origins.admin).href);
  await expect(page.getByLabel("Wedding event")).toHaveValue(f.event.id);
}
async function find(page: Page, name: string) {
  await page.getByRole("button", { name: "Find Guest", exact: true }).click();
  await page.getByLabel("Guest name or invitation reference").fill(name);
  await page
    .getByRole("button", { name: "Find registered guests", exact: true })
    .click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(
    page
      .getByRole("region", { name: "Household reception detail" })
      .getByRole("heading", { name, exact: true }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  const dialog = page.getByRole("dialog", {
    name: "Confirm reception arrival",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm arrival", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Arrival recorded", exact: true }),
  ).toBeVisible();
}
for (const width of [320, 375, 412, 768, 1280]) {
  test(`Guest Manager handles physical Pending household with explicit 2 + 1 + 1 arrivals at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const household = await f.household(`Reception Household ${width}`, {
      pending: true,
      plusOne: true,
      children: 2,
    });
    ids.push(household.id);
    await login(page);
    await find(page, household.name);
    await page
      .getByRole("checkbox", { name: "Synthetic Guest", exact: true })
      .check();
    await page.getByRole("checkbox", { name: "One plus-one guest" }).check();
    await page.getByLabel("Additional children", { exact: true }).fill("2");
    await page.getByLabel("Expected attendance confirmed by guest").fill("4");
    await page
      .getByLabel("Verification / changed-plans reason")
      .fill("Physical invitation checked with synthetic family");
    await page.getByLabel("Guests arriving now").fill("2");
    await page
      .getByRole("button", { name: "Confirm RSVP & Check-in", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Confirm reception arrival",
    });
    await expect(dialog).toContainText("add 2 arriving guests");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      await f.prisma.checkinRecord.count({
        where: { invitationId: household.id },
      }),
    ).toBe(0);
    await page
      .getByRole("button", { name: "Confirm RSVP & Check-in", exact: true })
      .click();
    await confirm(page);
    const section = page.getByRole("region", {
      name: "Household reception detail",
    });
    await expect(section).toContainText("Remaining expected guests2");
    await page.getByLabel("Guests arriving now").fill("1");
    await page
      .getByRole("button", { name: "Record additional arrival", exact: true })
      .click();
    await confirm(page);
    await page
      .getByRole("button", { name: "Record additional arrival", exact: true })
      .click();
    await confirm(page);
    await expect(section).toContainText("Fully checked in");
    await expect(
      page.getByRole("button", {
        name: "Record additional arrival",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await f.prisma.checkinRecord.findUniqueOrThrow({
          where: {
            invitationId_eventId: {
              invitationId: household.id,
              eventId: f.event.id,
            },
          },
        })
      ).attendeeCount,
    ).toBe(4);
    expect(
      await f.prisma.checkinArrival.count({
        where: { invitationId: household.id },
      }),
    ).toBe(3);
    expect(
      await f.prisma.rsvpChangeEvent.count({
        where: {
          invitationId: household.id,
          action: "ON_SITE_RSVP",
          actorAdminUserId: manager.id,
        },
      }),
    ).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await section.screenshot({
      path: info.outputPath(`reception-${width}.png`),
      animations: "disabled",
    });
    await page.reload();
    await find(page, household.name);
    await expect(section).toContainText("Fully checked in");
  });
}
test("lost arrival response is reconciled by operation ID without a second arrival", async ({
  page,
}) => {
  const household = await f.household("Reception Recovery Household");
  ids.push(household.id);
  await login(page);
  await find(page, household.name);
  let writes = 0;
  await page.route("**/api/admin/reception/arrivals", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Check-in", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Confirm reception arrival" })
    .getByRole("button", { name: "Confirm arrival", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Confirmation needs recovery",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check operation status", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Arrival recorded", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(
    await f.prisma.checkinArrival.count({
      where: { invitationId: household.id },
    }),
  ).toBe(1);
});
test("a Declined physical guest requires an explicit reason before an audited onsite change", async ({
  page,
}) => {
  const household = await f.household("Reception Changed Plans", {
    pending: true,
  });
  ids.push(household.id);
  await f.prisma.rSVP.create({
    data: { invitationId: household.id, status: "DECLINED", version: 3 },
  });
  await login(page);
  await find(page, household.name);
  await page
    .getByRole("checkbox", { name: "Synthetic Guest", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Confirm RSVP & Check-in", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await f.prisma.checkinRecord.count({
      where: { invitationId: household.id },
    }),
  ).toBe(0);
  await page
    .getByLabel("Verification / changed-plans reason")
    .fill("Guest changed plans; physical card verified at reception");
  await page
    .getByRole("button", { name: "Confirm RSVP & Check-in", exact: true })
    .click();
  await confirm(page);
  expect(
    await f.prisma.rsvpChangeEvent.count({
      where: {
        invitationId: household.id,
        action: "ON_SITE_RSVP",
        actorAdminUserId: manager.id,
      },
    }),
  ).toBe(1);
});
test("Guest Manager scans a real guest QR with the existing decoder and cannot access OWNER routes", async ({
  page,
  browser,
}) => {
  const household = await f.household("Reception QR Household");
  ids.push(household.id);
  const guestContext = await browser.newContext(),
    guest = await guestContext.newPage();
  try {
    await guest.goto(`${origins.invitation}/i/${household.publicCredential}`);
    await guest
      .getByRole("button", { name: "Open invitation", exact: true })
      .click();
    await expect(guest.locator(".checkin-code")).toBeVisible();
    let svg = await guest
      .getByRole("img", { name: "Household check-in pass QR code" })
      .evaluate((node) => node.outerHTML);
    if (!svg.includes("xmlns="))
      svg = svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
    await page.addInitScript((source) => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 320;
          const img = new Image(),
            url = URL.createObjectURL(
              new Blob([source], { type: "image/svg+xml" }),
            );
          img.src = url;
          await img.decode();
          URL.revokeObjectURL(url);
          const stream = canvas.captureStream(15),
            ctx = canvas.getContext("2d")!;
          let frame = 0;
          function paint() {
            ctx.drawImage(img, 0, 0, 320, 320);
            frame = requestAnimationFrame(paint);
          }
          paint();
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              cancelAnimationFrame(frame);
              stop();
            };
          }
          return stream;
        },
      });
    }, svg);
    await login(page);
    for (const url of [
      "/invitations",
      "/settings/staff",
      "/rsvps",
      "/events",
    ]) {
      await page.goto(url);
      await expect(page).toHaveURL(new URL("/reception", origins.admin).href);
      await expect(
        page.getByRole("heading", { name: "Guest reception", exact: true }),
      ).toBeVisible();
    }
    expect((await page.request.get("/api/admin/rsvps")).status()).toBe(403);
    await page.getByRole("button", { name: "Scan QR", exact: true }).click();
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: household.name, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Check-in", exact: true }).click();
    await confirm(page);
    expect(
      (
        await f.prisma.checkinRecord.findUniqueOrThrow({
          where: {
            invitationId_eventId: {
              invitationId: household.id,
              eventId: f.event.id,
            },
          },
        })
      ).method,
    ).toBe("QR");
    // Manual entry is a camera fallback, not a different credential namespace.
    const payload = (await guest.locator(".checkin-code").innerText()).trim();
    await page.getByRole("button", { name: "Scan QR", exact: true }).click();
    const qrInput = page.getByLabel("Guest check-in QR code", { exact: true });
    await expect(qrInput).toHaveAttribute("type", "password");
    await qrInput.fill(payload);
    await page
      .getByRole("button", { name: "Validate guest QR", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Household reception detail" }),
    ).toContainText("Fully checked in");
    await expect(qrInput).toHaveValue("");
    expect(
      await f.prisma.checkinArrival.count({
        where: { invitationId: household.id },
      }),
    ).toBe(1);
  } finally {
    await guestContext.close();
  }
});
