import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import type { FreezeCatering } from "../src/reports/client";
import { runnerOrigins } from "./origins";

const origins = runnerOrigins();
let cleanup: (() => Promise<void>) | undefined;

test.afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const freezePath = "/api/admin/reports/catering/snapshots";
const freezeButton = (page: Page) =>
  page.getByRole("button", { name: "Freeze catering numbers", exact: true });
const checkFreeze = (page: Page) =>
  page.getByRole("button", { name: "Check Freeze Result", exact: true });

async function openReports(page: Page) {
  const fixture = await createWorkflowFixture();
  cleanup = async () => {
    await fixture.prisma.cateringSnapshot.deleteMany({
      where: { capturedById: fixture.owner.id },
    });
    await fixture.cleanup();
  };
  expect(await fixture.prisma.cateringSnapshot.count()).toBe(0);
  await fixture.household("Synthetic catering recovery household");
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL("/", origins.admin).href);
  await page.goto("/reports");
  return fixture;
}

for (const failure of [
  "503 after commit",
  "network before commit",
  "invalid 200 after commit",
] as const) {
  test(`freeze recovery preserves one logical operation for ${failure}`, async ({
    page,
  }) => {
    const fixture = await openReports(page);
    const attempts: FreezeCatering[] = [];
    let committedReceipt: unknown;
    let recoveredReceipt: unknown;
    await page.route("**" + freezePath, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      attempts.push(route.request().postDataJSON());
      const first = attempts.length === 1;
      if (first && failure === "network before commit")
        return route.abort("failed");
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (!first) {
        recoveredReceipt = await response.json();
        return route.fulfill({ response });
      }
      committedReceipt = await response.json();
      if (failure === "503 after commit")
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "INTERNAL_SERVER_ERROR",
              message: "Synthetic failure",
              details: null,
            },
          },
        });
      return route.fulfill({ status: 200, json: { version: 1 } });
    });

    await page
      .getByRole("combobox", { name: "Session", exact: true })
      .selectOption(fixture.event.id);
    await page
      .getByRole("checkbox", {
        name: "Include archived households",
        exact: true,
      })
      .check();
    await expect(page.getByText(/Archived included/)).toBeVisible();
    if (failure === "503 after commit") {
      await expect(freezeButton(page)).toBeEnabled();
      await freezeButton(page).evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    } else {
      await freezeButton(page).click();
    }
    await expect(
      page.getByText(/The snapshot may have been saved/),
    ).toBeVisible();
    await expect(freezeButton(page)).toBeDisabled();
    expect(attempts).toHaveLength(1);
    const original = attempts[0]!;
    expect(original).toEqual({
      operationId: expect.any(String),
      expectedVersion: 0,
      eventId: fixture.event.id,
      includeArchived: true,
    });
    expect(await fixture.prisma.cateringSnapshot.count()).toBe(
      failure === "network before commit" ? 0 : 1,
    );
    await checkFreeze(page).click();
    await expect(
      page.getByText(/Catering snapshot V1 was saved at .* WIB/),
    ).toBeVisible();
    await expect(checkFreeze(page)).toHaveCount(0);
    expect(attempts).toEqual([original, original]);
    if (committedReceipt) expect(recoveredReceipt).toEqual(committedReceipt);
    const rows = await fixture.prisma.cateringSnapshot.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      operationId: original.operationId,
      payload: { scope: { eventId: original.eventId, includeArchived: true } },
    });
  });
}

test("freeze recovery resolves a verified conflict and waits for deliberate new freeze", async ({
  page,
}) => {
  const fixture = await openReports(page);
  const attempts: FreezeCatering[] = [];
  let conflict: unknown;
  await page.route("**" + freezePath, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) return route.abort("failed");
    const response = await route.fetch();
    if (attempts.length === 2) {
      expect(response.status()).toBe(409);
      conflict = await response.json();
    }
    return route.fulfill({ response });
  });

  await freezeButton(page).click();
  await expect(checkFreeze(page)).toBeEnabled();
  const pageTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  const original = attempts[0]!;
  expect(original.expectedVersion).toBe(0);
  expect(await fixture.prisma.cateringSnapshot.count()).toBe(0);
  const competing = { ...original, operationId: randomUUID() };
  const auth = await (await page.request.get("/api/admin/auth/me")).json();
  const winner = await page.request.post(freezePath, {
    data: competing,
    headers: { Origin: origins.admin, "X-CSRF-Token": auth.csrfToken },
  });
  expect(winner.status()).toBe(201);
  await checkFreeze(page).click();
  await expect(
    page.getByText(/Your freeze was not applied\. V1/),
  ).toBeVisible();
  expect(conflict).toMatchObject({
    error: {
      code: "CATERING_SNAPSHOT_VERSION_CONFLICT",
      details: { latestVersion: 1 },
    },
  });
  expect(attempts).toEqual([original, original]);
  expect(
    await fixture.prisma.cateringSnapshot.findMany({
      select: { version: true, operationId: true },
    }),
  ).toEqual([{ version: 1, operationId: competing.operationId }]);
  await expect(checkFreeze(page)).toHaveCount(0);
  await expect(freezeButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Review Latest Snapshot" }).click();
  await expect(
    page.getByRole("combobox", { name: "Official version" }),
  ).toHaveValue("1");
  await expect(
    page.getByRole("table", { name: "Frozen catering counts" }),
  ).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(
    pageTimeOrigin,
  );
  expect(attempts).toHaveLength(2);
  expect(await fixture.prisma.cateringSnapshot.count()).toBe(1);
  await page.getByRole("button", { name: "LIVE", exact: true }).click();
  await freezeButton(page).click();
  await expect(page.getByText(/Catering snapshot V2 was saved/)).toBeVisible();
  expect(attempts).toHaveLength(3);
  expect(attempts[2]!.expectedVersion).toBe(1);
  expect(attempts[2]!.operationId).not.toBe(original.operationId);
  expect(
    await fixture.prisma.cateringSnapshot.findMany({
      orderBy: { version: "asc" },
      select: { version: true, operationId: true },
    }),
  ).toEqual([
    { version: 1, operationId: competing.operationId },
    { version: 2, operationId: attempts[2]!.operationId },
  ]);
});

test("freeze recovery is not required for an initial CSRF rejection", async ({
  page,
}) => {
  const fixture = await openReports(page);
  let attempts = 0;
  await page.route("**" + freezePath, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    const response = await route.fetch({
      headers: { ...route.request().headers(), "x-csrf-token": "invalid" },
    });
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "CSRF_INVALID" },
    });
    await route.fulfill({ response });
  });
  await freezeButton(page).click();
  await expect(page.getByText(/Freeze request was rejected/)).toBeVisible();
  await expect(checkFreeze(page)).toHaveCount(0);
  await expect(freezeButton(page)).toBeEnabled();
  expect(attempts).toBe(1);
  expect(await fixture.prisma.cateringSnapshot.count()).toBe(0);
});

async function openInvitation(page: Page, credential: string) {
  await page.goto(`${origins.invitation}/i/${credential}`);
  await page
    .getByRole("button", { name: "Buka Undangan", exact: true })
    .click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
}

test("OWNER freezes catering counts and the mobile guest revises RSVP after the WIB deadline", async ({
  page,
  browser,
}) => {
  const fixture = await createWorkflowFixture();
  cleanup = () => fixture.cleanup();
  const policy = await fixture.prisma.weddingRsvpPolicy.findUniqueOrThrow({
    where: { id: 1 },
  });
  cleanup = async () => {
    await fixture.prisma.cateringSnapshot.deleteMany({
      where: { capturedById: fixture.owner.id },
    });
    const { id, ...data } = policy;
    await fixture.prisma.weddingRsvpPolicy.update({ where: { id }, data });
    await fixture.cleanup();
  };
  const accepted = await fixture.household("Catering RSVP synthetic household");
  const pending = await fixture.household("Catering RSVP synthetic pending", {
    pending: true,
  });
  const override = new Date("2031-02-03T12:34:56.123Z");
  await fixture.prisma.invitation.update({
    where: { id: accepted.id },
    data: { rsvpDeadlineAt: null },
  });
  await fixture.prisma.invitation.update({
    where: { id: pending.id },
    data: { rsvpDeadlineAt: override },
  });
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "America/Los_Angeles",
  });
  const secondTimezone = await browser.newContext({
    viewport: { width: 412, height: 844 },
    timezoneId: "Asia/Tokyo",
  });
  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new URL("/", origins.admin).href);
    await page.goto("/reports");
    await page.getByText("Configure RSVP deadlines", { exact: true }).click();
    await page
      .getByLabel("Initial RSVP deadline (WIB)")
      .fill("2026-01-02T00:30");
    await page
      .getByRole("checkbox", {
        name: "Allow previous respondents to edit after their initial deadline",
      })
      .check();
    await page.getByRole("button", { name: "Save RSVP settings" }).click();
    await expect(page.getByText("RSVP settings saved.")).toBeVisible();
    expect(
      await fixture.prisma.weddingRsvpPolicy.findUniqueOrThrow({
        where: { id: 1 },
      }),
    ).toMatchObject({
      initialDeadlineAt: new Date("2026-01-01T17:30:00.000Z"),
      allowLateEdits: true,
    });
    expect(
      (
        await fixture.prisma.invitation.findUniqueOrThrow({
          where: { id: pending.id },
        })
      ).rsvpDeadlineAt,
    ).toEqual(override);
    await expect(page.getByRole("link", { name: pending.name })).toBeVisible();
    await fixture.prisma.invitation.update({
      where: { id: pending.id },
      data: { rsvpDeadlineAt: null },
    });

    const session = page.getByRole("combobox", {
      name: "Session",
      exact: true,
    });
    await session.selectOption(fixture.event.id, { timeout: 15_000 });
    await expect(session).toHaveValue(fixture.event.id);
    await expect(
      page
        .getByRole("table", { name: "Live counts by session" })
        .getByRole("row", { name: new RegExp(fixture.event.name) }),
    ).toContainText("1");
    await page.getByRole("button", { name: "Freeze catering numbers" }).click();
    await expect(
      page.getByRole("table", { name: "Frozen catering counts" }),
    ).toBeVisible();
    const persisted = await fixture.prisma.cateringSnapshot.findFirstOrThrow({
      where: { capturedById: fixture.owner.id },
    });
    expect(persisted.payload).toMatchObject({
      scope: { eventId: fixture.event.id, includeArchived: false },
      rows: expect.arrayContaining([
        expect.objectContaining({ invitationId: accepted.id, rsvpExpected: 1 }),
      ]),
    });

    const guest = await mobile.newPage();
    await openInvitation(guest, accepted.publicCredential);
    await expect(
      guest.getByText(
        "Mohon berikan jawaban paling lambat 2 Januari 2026 pukul 00.30 WIB.",
      ),
    ).toBeVisible();
    await guest.getByRole("button", { name: "Ubah RSVP", exact: true }).click();
    await guest
      .getByRole("button", { name: "Ubah Rincian Kehadiran", exact: true })
      .click();
    await guest
      .getByRole("radio", { name: "Mohon maaf, tidak dapat hadir" })
      .check();
    await guest
      .getByRole("button", { name: "Simpan Perubahan", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Tidak Hadir", exact: true }),
    ).toBeVisible();
    expect(
      await fixture.prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: accepted.id },
      }),
    ).toMatchObject({
      status: "DECLINED",
      version: 2,
    });
    expect(
      await fixture.prisma.rsvpChangeEvent.count({
        where: { invitationId: accepted.id, action: "GUEST_UPDATE" },
      }),
    ).toBe(1);

    const firstReply = await secondTimezone.newPage();
    await openInvitation(firstReply, pending.publicCredential);
    await expect(
      firstReply.getByText(
        "Mohon berikan jawaban paling lambat 2 Januari 2026 pukul 00.30 WIB.",
      ),
    ).toBeVisible();
    await expect(
      firstReply.getByRole("button", { name: "Kirim RSVP", exact: true }),
    ).toBeDisabled();
    await expect(
      firstReply.getByText(
        "Batas waktu RSVP telah lewat. Hubungi kedua mempelai jika Anda memerlukan bantuan.",
      ),
    ).toBeVisible();
    expect(
      await fixture.prisma.rSVP.count({ where: { invitationId: pending.id } }),
    ).toBe(0);

    await page.setViewportSize({ width: 412, height: 844 });
    await page
      .getByRole("button", { name: "Refresh catering reports", exact: true })
      .click();
    await page.getByRole("button", { name: "CHANGES", exact: true }).click();
    const changes = page.getByRole("table", {
      name: "Changes by household and session",
    });
    await expect(changes).toContainText("ACCEPTED → DECLINED");
    await expect(changes).toContainText("1 → 0 (-1)");
    for (const name of [
      "Export frozen summary CSV",
      "Export frozen household and session CSV",
      "Export changes CSV",
    ]) {
      const downloading = page.waitForEvent("download");
      await page.getByRole("link", { name, exact: true }).click();
      const file = await downloading;
      expect(await file.failure()).toBeNull();
      expect(file.suggestedFilename()).toMatch(/^catering-v\d+-/);
    }
    expect(
      await fixture.prisma.cateringSnapshot.findUnique({
        where: { version: persisted.version },
      }),
    ).toEqual(persisted);
    const screen = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(screen.page).toBeLessThanOrEqual(screen.viewport + 2);
  } finally {
    await mobile.close();
    await secondTimezone.close();
  }
});
