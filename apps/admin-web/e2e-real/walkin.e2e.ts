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
      email: `walkin-manager-${f.owner.id}@example.test`,
      role: "GUEST_MANAGER",
      passwordHash: owner.passwordHash,
    },
  });
});
test.afterAll(async () => {
  if (!f) return;
  const rows = await f.prisma.receptionAction.findMany({
    where: { operatorId: manager.id },
    select: { invitationId: true },
  });
  const all = [...new Set([...ids, ...rows.map((r) => r.invitationId)])];
  await f.prisma.walkinRegistration.deleteMany({
    where: { invitationId: { in: all } },
  });
  await f.prisma.receptionAction.deleteMany({
    where: { invitationId: { in: all } },
  });
  await f.prisma.checkinRecord.deleteMany({
    where: { invitationId: { in: all } },
  });
  await f.prisma.checkinPass.deleteMany({
    where: { invitationId: { in: all } },
  });
  await f.prisma.rSVP.deleteMany({ where: { invitationId: { in: all } } });
  await f.prisma.invitationEvent.deleteMany({
    where: { invitationId: { in: all } },
  });
  await f.prisma.invitee.deleteMany({ where: { invitationId: { in: all } } });
  await f.prisma.invitation.deleteMany({ where: { id: { in: all } } });
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
async function prepare(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Guest Assistance", exact: true })
    .click();
  const form = page.getByRole("region", {
    name: "Guest Assistance registration",
  });
  await form.getByLabel("Lead guest or household name").fill(name);
  await form.getByRole("button", { name: "Check existing guest list" }).click();
  await expect(
    form.getByRole("heading", { name: "Potential matching households" }),
  ).toBeVisible();
  await form
    .getByRole("checkbox", {
      name: "I checked the guest list and verified this is an unregistered household",
    })
    .check();
  await form.getByLabel("Expected total household attendance").fill("3");
  await form.getByLabel("People arriving now").fill("2");
  await form
    .getByLabel("Registration reason")
    .fill("Synthetic family identification verified at reception");
  return form;
}
async function confirm(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Confirm reception change" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
for (const width of [320, 375, 412, 768, 1280])
  test(`walkin registration, later arrival and audited correction at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    const name = `Walkin Browser Family ${width}`,
      form = await prepare(page, name);
    await form
      .getByRole("button", { name: "Review registration & Check-in" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(
      await f.prisma.invitation.count({ where: { displayName: name } }),
    ).toBe(0);
    await form
      .getByRole("button", { name: "Review registration & Check-in" })
      .click();
    await confirm(page);
    await expect(
      form.getByRole("heading", { name: "Guest Registered & Checked In" }),
    ).toBeVisible();
    await expect(form).toContainText(
      "Arrived: 2 guests · Expected: 3 guests · Remaining: 1",
    );
    const row = await f.prisma.invitation.findFirstOrThrow({
      where: { displayName: name },
    });
    ids.push(row.id);
    const household = page.getByRole("region", {
      name: "Household reception detail",
    });
    await expect(household).toContainText("Walk-in");
    await household.getByLabel("Guests arriving now").fill("1");
    await household
      .getByRole("button", { name: "Record additional arrival", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Confirm reception arrival" })
      .getByRole("button", { name: "Confirm arrival", exact: true })
      .click();
    await expect(household).toContainText("Fully checked in");
    const adjustment = page.getByRole("region", {
      name: "Attendance adjustments",
    });
    await adjustment.getByLabel("Correct total attendance").fill("2");
    await adjustment
      .getByLabel("Correction / exception reason")
      .fill("One guest was counted twice; verified with family");
    await adjustment
      .getByRole("button", { name: "Review attendance change" })
      .click();
    await confirm(page);
    await expect(
      adjustment.getByRole("heading", { name: "Attendance corrected" }),
    ).toBeVisible();
    expect(
      (
        await f.prisma.checkinRecord.findFirstOrThrow({
          where: { invitationId: row.id },
        })
      ).attendeeCount,
    ).toBe(2);
    expect(
      await f.prisma.checkinArrival.count({ where: { invitationId: row.id } }),
    ).toBe(2);
    expect(
      await f.prisma.receptionAction.count({
        where: { invitationId: row.id, kind: "CORRECTION" },
      }),
    ).toBe(1);
    await expect(
      page.getByRole("button", { name: "Find Guest", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`walkin-${width}.png`),
      fullPage: true,
    });
    await page.reload();
    await page
      .getByLabel("Guest name or invitation reference")
      .fill(row.referenceCode);
    await page.getByRole("button", { name: "Find registered guests" }).click();
    await page
      .getByRole("button", { name: new RegExp(row.referenceCode) })
      .click();
    await expect(
      page.getByRole("region", { name: "Household reception detail" }),
    ).toContainText("Remaining expected guests1");
  });
test("lost register response recovers the one committed household and freezes new operations", async ({
  page,
}) => {
  await login(page);
  const name = "Walkin Browser Recovery",
    form = await prepare(page, name);
  let writes = 0;
  await page.route("**/api/admin/reception/walkins", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await form
    .getByRole("button", { name: "Review registration & Check-in" })
    .click();
  await confirm(page);
  await expect(
    form.getByRole("heading", { name: "Check the original operation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find Guest", exact: true }),
  ).toBeDisabled();
  await form.getByRole("button", { name: "Check confirmed operation" }).click();
  await expect(
    form.getByRole("heading", { name: "Guest Registered & Checked In" }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(
    await f.prisma.invitation.count({ where: { displayName: name } }),
  ).toBe(1);
});
test("a physical-card guest found in the list opens the existing household instead of creating a walkin", async ({
  page,
}) => {
  const household = await f.household("Already Listed Physical Family");
  await login(page);
  await page
    .getByRole("button", { name: "Guest Assistance", exact: true })
    .click();
  const assistance = page.getByRole("region", {
    name: "Guest Assistance registration",
  });
  await assistance
    .getByLabel("Lead guest or household name")
    .fill(household.name);
  await assistance
    .getByRole("button", { name: "Check existing guest list" })
    .click();
  await expect(
    assistance.getByLabel("Why this is a different household"),
  ).toBeVisible();
  await assistance
    .getByRole("button", { name: /Open existing household/ })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Household reception detail" })
      .getByRole("heading", { name: household.name, exact: true }),
  ).toBeVisible();
  expect(
    await f.prisma.walkinRegistration.count({
      where: { invitationId: household.id },
    }),
  ).toBe(0);
  await expect(assistance).toHaveCount(0);
});
test("OWNER-only link delivery renders unnamed companions on the real public invitation without reopening RSVP", async ({
  page,
  browser,
}) => {
  await login(page);
  const name = "Walkin Owner Delivery",
    form = await prepare(page, name);
  await form
    .getByRole("button", { name: "Review registration & Check-in" })
    .click();
  await confirm(page);
  await expect(
    form.getByRole("heading", { name: "Guest Registered & Checked In" }),
  ).toBeVisible();
  const invitation = await f.prisma.invitation.findFirstOrThrow({
    where: { displayName: name },
  });
  ids.push(invitation.id);
  expect(
    (
      await page.request.get(
        `/api/admin/invitations/${invitation.id}/public-url`,
      )
    ).status(),
  ).toBe(403);
  const ownerContext = await browser.newContext(),
    guestContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    await owner.goto(new URL("/login", origins.admin).href);
    await owner.getByLabel("Email", { exact: true }).fill(f.owner.email);
    await owner.getByLabel("Password", { exact: true }).fill(f.password);
    await owner.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(owner).toHaveURL(new URL("/", origins.admin).href);
    const response = await owner.request.get(
      new URL(
        `/api/admin/invitations/${invitation.id}/public-url`,
        origins.admin,
      ).href,
    );
    expect(response.status()).toBe(200);
    const result = await response.json();
    const guest = await guestContext.newPage();
    await guest.goto(result.publicUrl);
    await guest
      .getByRole("button", { name: "Open invitation", exact: true })
      .click();
    await expect(
      guest.getByText("Unnamed companions × 2", { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Edit RSVP", exact: true }),
    ).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
