import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN ?? "http://localhost:3001";
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
test.beforeAll(async () => {
  fixture = await createWorkflowFixture();
});
test.afterAll(async () => {
  await fixture?.cleanup();
});
async function login(page: Page, email: string, password = fixture.password) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(`${ADMIN_ORIGIN}/login`);
}
async function checkin(page: Page) {
  await page.goto("/checkin");
  await page
    .getByLabel("Event", { exact: true })
    .selectOption(fixture.event.id);
}
test("real OWNER QR and staff manual confirmations persist the session operator", async ({
  page,
  browser,
}) => {
  const qr = await fixture.household("Workflow QR Household"),
    manual = await fixture.household("Workflow Manual Household");
  await login(page, fixture.owner.email);
  await checkin(page);
  await page.getByLabel("QR code", { exact: true }).fill(qr.qrPayload);
  await page.getByRole("button", { name: "Validate QR", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm check-in", exact: true }),
  ).toBeVisible();
  expect(
    await fixture.prisma.checkinRecord.count({
      where: { invitationId: qr.id },
    }),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Confirm check-in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check-in confirmed", exact: true }),
  ).toBeVisible();
  const context = await browser.newContext({
    baseURL: ADMIN_ORIGIN,
  });
  const staff = await context.newPage();
  try {
    await login(staff, fixture.staff.email);
    await staff
      .getByLabel("Event", { exact: true })
      .selectOption(fixture.event.id);
    await staff.getByLabel("Household name").fill(manual.name);
    await staff.getByRole("button", { name: "Search households" }).click();
    await staff.getByRole("button", { name: new RegExp(manual.name) }).click();
    await staff
      .getByRole("button", { name: "Confirm check-in", exact: true })
      .click();
    await expect(
      staff.getByRole("heading", { name: "Check-in confirmed", exact: true }),
    ).toBeVisible();
    for (const path of [
      "/api/admin/dashboard",
      "/api/admin/invitations",
      "/api/admin/rsvps",
      "/api/admin/messages",
      "/api/admin/staff",
    ]) {
      expect((await context.request.get(path)).status()).toBe(403);
    }
    const records = await fixture.prisma.checkinRecord.findMany({
      where: { invitationId: { in: [qr.id, manual.id] } },
      select: {
        invitationId: true,
        method: true,
        attendeeCount: true,
        confirmedByAdminUserId: true,
      },
    });
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      expect.arrayContaining([
        {
          invitationId: qr.id,
          method: "QR",
          attendeeCount: 1,
          confirmedByAdminUserId: fixture.owner.id,
        },
        {
          invitationId: manual.id,
          method: "MANUAL",
          attendeeCount: 1,
          confirmedByAdminUserId: fixture.staff.id,
        },
      ]),
    );
  } finally {
    await context.close();
  }
});
test("real lost manual response is recovered by exact status without a second write", async ({
  page,
}) => {
  const household = await fixture.household("Workflow Lost Household");
  await login(page, fixture.owner.email);
  await checkin(page);
  let writes = 0;
  await page.route("**/api/admin/checkin/manual-confirm", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByLabel("Household name").fill(household.name);
  await page.getByRole("button", { name: "Search households" }).click();
  await page.getByRole("button", { name: new RegExp(household.name) }).click();
  await page
    .getByRole("button", { name: "Confirm check-in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check the server before continuing" }),
  ).toBeVisible();
  await fixture.prisma.invitation.update({
    where: { id: household.id },
    data: {
      displayName: "Renamed after confirmation",
      status: "ARCHIVED",
      archivedAt: new Date(),
    },
  });
  await page
    .getByRole("button", { name: "Recheck exact household and event" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Already confirmed", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
  expect(
    await fixture.prisma.checkinRecord.count({
      where: { invitationId: household.id, eventId: fixture.event.id },
    }),
  ).toBe(1);
});
test("two real browser operators cannot double-confirm the same household/event", async ({
  page,
  browser,
}) => {
  const household = await fixture.household("Workflow Race Household");
  await login(page, fixture.owner.email);
  await checkin(page);
  const context = await browser.newContext({
      baseURL: ADMIN_ORIGIN,
    }),
    other = await context.newPage();
  try {
    await login(other, fixture.staff.email);
    await other
      .getByLabel("Event", { exact: true })
      .selectOption(fixture.event.id);
    for (const operator of [page, other]) {
      await operator
        .getByLabel("QR code", { exact: true })
        .fill(household.qrPayload);
      await operator
        .getByRole("button", { name: "Validate QR", exact: true })
        .click();
      await expect(
        operator.getByRole("button", { name: "Confirm check-in", exact: true }),
      ).toBeVisible();
    }
    await Promise.all([
      page
        .getByRole("button", { name: "Confirm check-in", exact: true })
        .click(),
      other
        .getByRole("button", { name: "Confirm check-in", exact: true })
        .click(),
    ]);
    await expect
      .poll(() =>
        fixture.prisma.checkinRecord.count({
          where: { invitationId: household.id, eventId: fixture.event.id },
        }),
      )
      .toBe(1);
    await expect
      .poll(async () => {
        const texts = await Promise.all([
          page.locator("body").innerText(),
          other.locator("body").innerText(),
        ]);
        return texts.filter((text) => text.includes("Check-in confirmed"))
          .length;
      })
      .toBe(1);
  } finally {
    await context.close();
  }
});
test("real reports match persisted attendance and export only the selected household/event rows", async ({
  page,
}) => {
  const waiting = await fixture.household("Workflow Waiting Household");
  await login(page, fixture.owner.email);
  await page.goto("/reports");
  await page.getByLabel("Report event").selectOption(fixture.event.id);
  const expected = await fixture.prisma.rSVPEventSelection.aggregate({
    where: {
      eventId: fixture.event.id,
      attending: true,
      rsvp: { status: "ACCEPTED", invitation: { status: "ACTIVE" } },
    },
    _sum: { expectedAttendeeCount: true },
  });
  const actual = await fixture.prisma.checkinRecord.aggregate({
    where: { eventId: fixture.event.id, invitation: { status: "ACTIVE" } },
    _sum: { attendeeCount: true },
  });
  const row = page
    .getByRole("table", { name: "Attendance per event" })
    .getByRole("row")
    .filter({ hasText: fixture.event.name });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").nth(0)).toHaveText(
    String(expected._sum.expectedAttendeeCount ?? 0),
  );
  await expect(row.getByRole("cell").nth(1)).toHaveText(
    String(actual._sum.attendeeCount ?? 0),
  );
  await page.getByLabel("Report type").selectOption("NOT_ARRIVED");
  await expect(
    page.getByRole("row").filter({ hasText: waiting.name }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export household CSV" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("wedding-report-not-arrived.csv");
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream!) content += String(chunk);
  expect(content).toContain(waiting.name);
  for (const field of ["qrPayload", "publicTokenHash", "tokenHash"])
    expect(content.includes(field)).toBe(false);
});
test("personal message reads the current link without recording an open and detects rotation before copy", async ({
  page,
}) => {
  const household = await fixture.household("Workflow Message Household");
  await login(page, fixture.owner.email);
  await page.addInitScript(() => {
    Object.assign(window, { copiedMessages: [] });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Reflect.get(window, "copiedMessages").push(value);
        },
      },
    });
  });
  await page.goto(`/invitations/${household.id}`);
  await page.getByRole("button", { name: "Prepare personal message" }).click();
  const preview = page.getByLabel("Message preview");
  await expect(preview).toContainText(household.name);
  await expect(preview).toContainText(fixture.event.name);
  await page
    .getByRole("button", { name: "Copy personal message", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "copiedMessages").length),
    )
    .toBe(1);
  const auth = await (await page.request.get("/api/admin/auth/me")).json();
  const rotation = await page.request.post(
    `/api/admin/invitations/${household.id}/regenerate-token`,
    {
      headers: {
        Origin: ADMIN_ORIGIN,
        "X-CSRF-Token": auth.csrfToken,
      },
      data: { expectedTokenVersion: 1 },
    },
  );
  expect(rotation.status()).toBe(200);
  await page
    .getByRole("button", { name: "Copy personal message", exact: true })
    .click();
  await expect(page.getByText(/The invitation link changed/)).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "copiedMessages").length),
  ).toBe(1);
  await page
    .getByRole("button", { name: "Copy personal message", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "copiedMessages").length),
    )
    .toBe(2);
  expect(
    (
      await fixture.prisma.invitation.findUniqueOrThrow({
        where: { id: household.id },
      })
    ).openCount,
  ).toBe(0);
});
test("real OWNER reset and disable revoke staff sessions; first sign-in enforces password change", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
      baseURL: ADMIN_ORIGIN,
    }),
    staff = await context.newPage();
  try {
    await login(staff, fixture.staff.email);
    await login(page, fixture.owner.email);
    await page.goto("/settings/staff");
    await page
      .getByRole("button", {
        name: `Reset password for ${fixture.staff.email}`,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Confirm staff update" }).click();
    const credential = page.getByRole("region", {
      name: "Temporary credential",
    });
    await expect(credential).toBeVisible();
    const temporary = await credential.locator("code").innerText();
    expect((await context.request.get("/api/admin/auth/me")).status()).toBe(
      401,
    );
    await login(staff, fixture.staff.email, temporary);
    await expect(staff).toHaveURL(`${ADMIN_ORIGIN}/account/password`);
    await staff.getByLabel("Current password", { exact: true }).fill(temporary);
    await staff
      .getByLabel("New password", { exact: true })
      .fill("synthetic changed workflow password");
    await staff
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(staff).toHaveURL(`${ADMIN_ORIGIN}/checkin`);
    await page
      .getByRole("button", {
        name: `Disable ${fixture.staff.email}`,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Confirm staff update" }).click();
    await expect(
      page.getByRole("button", {
        name: `Activate ${fixture.staff.email}`,
        exact: true,
      }),
    ).toBeVisible();
    expect((await context.request.get("/api/admin/auth/me")).status()).toBe(
      401,
    );
    expect(
      (
        await fixture.prisma.adminUser.findUniqueOrThrow({
          where: { id: fixture.staff.id },
        })
      ).status,
    ).toBe("DISABLED");
  } finally {
    await context.close();
  }
});
