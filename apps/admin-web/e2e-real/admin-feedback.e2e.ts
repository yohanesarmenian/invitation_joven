import { expect, test } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";
const origins = runnerOrigins();
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
test.beforeAll(async () => {
  fixture = await createWorkflowFixture();
  await fixture.prisma.event.update({
    where: { id: fixture.event.id },
    data: {
      startsAt: new Date("2027-01-02T10:00:37.456Z"),
      endsAt: new Date("2027-01-02T12:00:19.123Z"),
    },
  });
});
test.afterAll(async () => {
  await fixture?.cleanup();
});
for (const width of [320, 375, 412, 768, 1280, 1440])
  test(`Event minute editing and confirmed save feedback remain usable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new URL("/", origins.admin).href);
    await page.goto("/events");
    await page.getByLabel("Event to edit").selectOption(fixture.event.id);
    const start = page.getByLabel("Start (WIB)", { exact: true }),
      end = page.getByLabel("End (WIB)", { exact: true });
    await expect(start).toHaveValue("2027-01-02T17:00");
    await expect(start).toHaveAttribute("step", "60");
    await expect(end).toHaveAttribute("step", "60");
    await page
      .getByLabel("Venue name", { exact: true })
      .fill(`Local minute review ${width}`);
    let writes = 0;
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname.startsWith(
          "/api/admin/event-management/",
        )
      )
        writes++;
    });
    await page
      .getByRole("button", { name: "Save event", exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect(
      page.getByRole("status").filter({ hasText: "Event saved successfully." }),
    ).toBeVisible();
    expect(writes).toBe(1);
    const row = await fixture.prisma.event.findUniqueOrThrow({
      where: { id: fixture.event.id },
    });
    expect(row.startsAt?.toISOString()).toBe("2027-01-02T10:00:37.456Z");
    expect(row.endsAt?.toISOString()).toBe("2027-01-02T12:00:19.123Z");
    await page.reload();
    await page.getByLabel("Event to edit").selectOption(fixture.event.id);
    await expect(start).toHaveValue("2027-01-02T17:00");
    await end.fill("2027-01-02T16:00");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(
      page.getByText("End must be later than start in WIB.", { exact: true }),
    ).toBeVisible();
    await expect(end).toHaveAttribute("aria-invalid", "true");
    expect(
      (
        await fixture.prisma.event.findUniqueOrThrow({
          where: { id: fixture.event.id },
        })
      ).endsAt?.toISOString(),
    ).toBe("2027-01-02T12:00:19.123Z");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("region", { name: "Event management editor" })
      .screenshot({ path: info.outputPath(`event-feedback-${width}.png`) });
  });
test("changed event time saves the selected minute and a rejected server write preserves the draft with error feedback", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL("/", origins.admin).href);
  await page.goto("/events");
  await page.getByLabel("Event to edit").selectOption(fixture.event.id);
  await page.getByLabel("End (WIB)", { exact: true }).fill("2027-01-02T20:15");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page.getByText("Event saved successfully.", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await fixture.prisma.event.findUniqueOrThrow({
        where: { id: fixture.event.id },
      })
    ).endsAt?.toISOString(),
  ).toBe("2027-01-02T13:15:00.000Z");
  await page.getByLabel("Event to edit").selectOption("");
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Conflicting review event");
  await page.getByLabel("Slug", { exact: true }).fill(fixture.event.slug);
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Event management editor" })
      .getByRole("alert"),
  ).toContainText("Slug or display order is already used.");
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue(
    "Conflicting review event",
  );
  await expect(
    page.getByText("Event saved successfully.", { exact: true }),
  ).toHaveCount(0);
  expect(
    await fixture.prisma.event.count({
      where: { name: "Conflicting review event" },
    }),
  ).toBe(0);
});
test("six viewport navigation and scrollable correction dialog use the real persisted reception and public page", async ({
  page,
  browser,
}, info) => {
  const household = await fixture.household(
    "Responsive local review household",
  );
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL("/", origins.admin).href);
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    for (const width of [320, 375, 412, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/invitations/new", "/invitations/import"]) {
        await page.goto(path);
        await expect(page.locator("#invitee-0, #import-file")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`${path.split("/").at(-1)}-${width}.png`),
          fullPage: true,
        });
      }
      await page.goto("/reception");
      await page.getByLabel("Wedding event").selectOption(fixture.event.id);
      await page
        .getByLabel("Guest name or invitation reference")
        .fill(household.name);
      await page
        .getByRole("button", { name: "Find registered guests" })
        .click();
      await page
        .getByRole("button", { name: new RegExp(household.name) })
        .click();
      const detail = page.getByRole("region", {
        name: "Household reception detail",
      });
      await expect(
        detail.getByRole("heading", { name: household.name, exact: true }),
      ).toBeVisible();
      if (width === 320) {
        await detail
          .getByRole("button", { name: "Check-in", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "Confirm reception arrival" })
          .getByRole("button", { name: "Confirm arrival", exact: true })
          .click();
        await expect(detail).toContainText("Fully checked in");
      }
      const adjustments = page.getByRole("region", {
        name: "Attendance adjustments",
      });
      await adjustments.getByLabel("Correct total attendance").fill("0");
      await adjustments
        .getByLabel("Correction / exception reason")
        .fill("Responsive dialog review only, confirmation will be cancelled");
      await adjustments
        .getByRole("button", { name: "Review attendance change" })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Confirm reception change",
      });
      await expect(dialog).toBeVisible();
      expect(
        await dialog.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return (
            box.width <= innerWidth &&
            box.height <= innerHeight &&
            getComputedStyle(node).overflowY === "auto"
          );
        }),
      ).toBe(true);
      await dialog.screenshot({
        path: info.outputPath(`correction-dialog-${width}.png`),
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`reception-${width}.png`),
        fullPage: true,
      });
      await guest.setViewportSize({ width, height: 900 });
      await guest.goto(`${origins.invitation}/i/${household.publicCredential}`);
      await guest
        .getByRole("button", { name: "Open invitation", exact: true })
        .click();
      await expect(guest.locator(".invitation-opening-flow")).toHaveAttribute(
        "data-stage",
        "content",
      );
      await expect(
        guest.getByRole("heading", {
          name: "Attendance Confirmed",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await guest.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await guest.screenshot({
        path: info.outputPath(`public-${width}.png`),
        fullPage: true,
        mask: [
          guest.locator(".checkin-code"),
          guest.getByRole("img", { name: "Household check-in pass QR code" }),
        ],
      });
    }
    expect(
      (
        await fixture.prisma.checkinRecord.findFirstOrThrow({
          where: { invitationId: household.id },
        })
      ).attendeeCount,
    ).toBe(1);
    expect(
      await fixture.prisma.receptionAction.count({
        where: { invitationId: household.id, kind: "CORRECTION" },
      }),
    ).toBe(0);
  } finally {
    await guestContext.close();
  }
});
test("Event creation shows confirmed success and a pending save stays disabled until the real database lock is released", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL("/", origins.admin).href);
  await page.goto("/events");
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Local feedback creation");
  await page
    .getByLabel("Slug", { exact: true })
    .fill(`local-feedback-${fixture.event.id}`);
  await page
    .getByLabel("Start (WIB)", { exact: true })
    .fill("2027-06-14T16:52");
  await page.getByRole("button", { name: "Save event", exact: true }).click();
  await expect(
    page.getByText("Event saved successfully.", { exact: true }),
  ).toBeVisible();
  const created = await fixture.prisma.event.findUniqueOrThrow({
    where: { slug: `local-feedback-${fixture.event.id}` },
  });
  try {
    expect(created.startsAt?.toISOString()).toBe("2027-06-14T09:52:00.000Z");
    await page.reload();
    await page.getByLabel("Event to edit").selectOption(created.id);
    await expect(page.getByLabel("Start (WIB)", { exact: true })).toHaveValue(
      "2027-06-14T16:52",
    );
    await page
      .getByLabel("Venue name", { exact: true })
      .fill("Confirmed after database commit");
    await expect(
      page.getByText("Unsaved event changes.", { exact: true }),
    ).toBeVisible();
    let release = () => {};
    let locked = () => {};
    const waitForRelease = new Promise<void>((done) => (release = done)),
      waitForLock = new Promise<void>((done) => (locked = done));
    const transaction = fixture.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM events WHERE id=${created.id}::uuid FOR UPDATE`;
        locked();
        await waitForRelease;
      },
      { timeout: 20000 },
    );
    await waitForLock;
    try {
      await page
        .getByRole("button", { name: "Save event", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Saving…", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByText("Event saved successfully.", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("status").filter({ hasText: "Saving event…" }),
      ).toBeVisible();
    } finally {
      release();
      await transaction;
    }
    await expect(
      page.getByText("Event saved successfully.", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await fixture.prisma.event.findUniqueOrThrow({
          where: { id: created.id },
        })
      ).venueName,
    ).toBe("Confirmed after database commit");
  } finally {
    await fixture.prisma.event.delete({ where: { id: created.id } });
  }
});
