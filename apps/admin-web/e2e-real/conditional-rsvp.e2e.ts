import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";

const origins = runnerOrigins();
const alone = "Saya hadir sendiri";
const family = "Saya hadir bersama keluarga";
const plusOne = "Saya hadir bersama pendamping";
const ceremony = "Morning Gathering";
const reception = "Evening Celebration";
const both = `${reception} & ${ceremony}`;
const firstName = "Synthetic Adult Alpha";
const secondName = "Synthetic Adult Bravo";
const childName = "Synthetic Named Child";

async function conditionalFixture() {
  const fixture = await createWorkflowFixture();
  await fixture.prisma.event.update({
    where: { id: fixture.event.id },
    data: { name: reception },
  });
  const event = await fixture.prisma.event.create({
    data: {
      name: ceremony,
      slug: `rsvp-${randomUUID()}`,
      displayOrder: fixture.event.displayOrder + 1,
    },
  });
  const households: string[] = [];
  return {
    ...fixture,
    ceremony: event,
    async createHousehold(
      label: string,
      options: { both: boolean; plus: boolean; pending: boolean },
    ) {
      const guest = await fixture.household(label, {
        pending: options.pending,
        plusOne: options.plus,
        children: 2,
      });
      households.push(guest.id);
      const first = await fixture.prisma.invitee.findFirstOrThrow({
        where: { invitationId: guest.id },
      });
      await fixture.prisma.invitee.update({
        where: { id: first.id },
        data: { fullName: firstName },
      });
      const second = await fixture.prisma.invitee.create({
        data: {
          invitationId: guest.id,
          fullName: secondName,
          category: "ADULT",
          displayOrder: 2,
        },
      });
      const child = await fixture.prisma.invitee.create({
        data: {
          invitationId: guest.id,
          fullName: childName,
          category: "CHILD",
          displayOrder: 3,
        },
      });
      if (options.both)
        await fixture.prisma.invitationEvent.create({
          data: { invitationId: guest.id, eventId: event.id },
        });
      return {
        ...guest,
        first,
        second,
        child,
        url: `${origins.api}/api/public/invitations/${guest.publicCredential}/rsvp`,
      };
    },
    async remove() {
      await fixture.prisma.checkinRecord.deleteMany({
        where: { invitationId: { in: households } },
      });
      await fixture.prisma.checkinPass.deleteMany({
        where: { invitationId: { in: households } },
      });
      await fixture.prisma.rSVP.deleteMany({
        where: { invitationId: { in: households } },
      });
      await fixture.prisma.invitationEvent.deleteMany({
        where: { eventId: event.id },
      });
      await fixture.prisma.event.delete({ where: { id: event.id } });
      await fixture.cleanup();
    },
  };
}

async function open(page: Page, credential: string) {
  await page.goto(`${origins.invitation}/i/${credential}`);
  await page
    .getByRole("button", { name: "Buka Undangan", exact: true })
    .click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
}
function radio(page: Page, name: string) {
  return page.getByRole("radio", { name, exact: true });
}
function check(page: Page, name: string) {
  return page.getByRole("checkbox", { name, exact: true }).check();
}
function notes(page: Page) {
  return page.getByRole("textbox", {
    name: "Kebutuhan dan preferensi makanan (opsional)",
  });
}
function save(page: Page, initial = false) {
  return page.getByRole("button", {
    name: initial ? "Kirim RSVP" : "Simpan Perubahan",
    exact: true,
  });
}
async function waitSaved(page: Page, accepted = true) {
  await expect(
    page.getByRole("heading", {
      name: accepted ? "Kehadiran Terkonfirmasi" : "Tidak Hadir",
      exact: true,
    }),
  ).toBeVisible();
}
async function edit(page: Page) {
  await page.getByRole("button", { name: "Ubah RSVP", exact: true }).click();
  await expect(page.getByRole("form", { name: "RSVP Anda" })).toBeVisible();
}
const attending = (eventId: string, expectedAttendeeCount: number) => ({
  eventId,
  attending: true,
  expectedAttendeeCount,
});
const named = (inviteeId: string) => ({
  type: "NAMED_INVITEE",
  inviteeId,
  quantity: 1,
});
const partner = { type: "PLUS_ONE", inviteeId: null, quantity: 1 };
const children = (quantity: number) => ({
  type: "ADDITIONAL_CHILD",
  inviteeId: null,
  quantity,
});

test("conditional public RSVP round-trips identities, session counts, family, and branch replacement", async ({
  page,
  browser,
  request,
}, info) => {
  const fixture = await conditionalFixture();
  const guestContext = await browser.newContext({
    viewport: { width: 320, height: 880 },
  });
  try {
    const household = await fixture.createHousehold(
      "Synthetic conditional household",
      { both: true, plus: true, pending: true },
    );
    const guest = await guestContext.newPage();
    const read = async () => {
      const result = await request.get(household.url);
      expect(result.status()).toBe(200);
      return result.json();
    };
    const persisted = () =>
      fixture.prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: household.id },
        include: { attendees: true, eventSelections: true },
      });
    await open(guest, household.publicCredential);
    await expect(radio(guest, "Dengan senang hati hadir")).not.toBeChecked();
    await expect(
      radio(guest, "Mohon maaf, tidak dapat hadir"),
    ).not.toBeChecked();
    await expect(radio(guest, both)).toHaveCount(0);
    await expect(radio(guest, family)).toHaveCount(0);
    await expect(notes(guest)).toHaveCount(0);
    expect((await read()).rsvp).toBeNull();
    await radio(guest, "Dengan senang hati hadir").focus();
    await guest.keyboard.press("Space");
    await expect(radio(guest, both)).toBeVisible();
    await expect(radio(guest, family)).toHaveCount(0);
    await radio(guest, ceremony).check();
    await radio(guest, alone).check();
    await expect(radio(guest, firstName)).not.toBeChecked();
    await expect(radio(guest, secondName)).not.toBeChecked();
    await radio(guest, secondName).check();
    await expect(notes(guest)).toBeVisible();
    await expect(
      guest.getByRole("region", { name: "Ringkasan kehadiran" }),
    ).toContainText(secondName);
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await guest
      .getByRole("form", { name: "RSVP Anda" })
      .screenshot({ path: info.outputPath("conditional-mobile.png") });
    await save(guest, true).evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await waitSaved(guest);
    const first = await read();
    expect(first.rsvp).toMatchObject({
      partyMode: "ALONE",
      version: 1,
      attendees: [named(household.second.id)],
      eventSelections: [attending(fixture.ceremony.id, 1)],
    });
    expect((await persisted()).attendees).toMatchObject([
      { inviteeId: household.second.id },
    ]);
    expect(
      await fixture.prisma.checkinPass.count({
        where: { invitationId: household.id },
      }),
    ).toBe(1);

    await fixture.prisma.invitee.update({
      where: { id: household.first.id },
      data: { displayOrder: 4 },
    });
    await open(guest, household.publicCredential);
    await edit(guest);
    await expect(radio(guest, secondName)).toBeChecked();
    await expect(radio(guest, firstName)).not.toBeChecked();
    await radio(guest, reception).check();
    await radio(guest, family).check();
    await check(guest, firstName);
    await save(guest).click();
    await waitSaved(guest);
    const twoAdults = await read();
    expect(twoAdults.rsvp).toMatchObject({
      partyMode: "FAMILY",
      version: 2,
      attendeeQuantityTotal: 2,
      attendees: expect.arrayContaining([
        named(household.first.id),
        named(household.second.id),
      ]),
      eventSelections: [attending(fixture.event.id, 2)],
    });
    expect(twoAdults.rsvp.attendees).toHaveLength(2);
    expect(twoAdults.checkinPass).toEqual(first.checkinPass);

    await edit(guest);
    await radio(guest, both).check();
    await guest
      .getByRole("checkbox", { name: firstName, exact: true })
      .uncheck();
    await expect(guest.getByRole("spinbutton")).toHaveCount(0);
    await check(guest, "Sertakan anak");
    await check(guest, childName);
    await guest.getByRole("spinbutton", { name: /anak tambahan/i }).fill("2");
    await notes(guest).fill("Synthetic first dietary preference");
    await expect(
      guest.getByRole("region", { name: "Ringkasan kehadiran" }),
    ).toContainText("4 orang akan hadir di setiap sesi yang dipilih");
    await save(guest).click();
    await waitSaved(guest);
    const four = await read();
    expect(four.rsvp).toMatchObject({
      partyMode: "FAMILY",
      version: 3,
      attendeeQuantityTotal: 4,
      attendees: expect.arrayContaining([
        named(household.second.id),
        named(household.child.id),
        children(2),
      ]),
      eventSelections: expect.arrayContaining([
        attending(fixture.ceremony.id, 4),
        attending(fixture.event.id, 4),
      ]),
    });
    expect(four.rsvp.attendees).toHaveLength(3);
    const rows = await persisted();
    expect(rows.publicPartyMode).toBe("FAMILY");
    expect(
      rows.eventSelections.map(
        ({ expectedAttendeeCount }) => expectedAttendeeCount,
      ),
    ).toEqual([4, 4]);
    expect(rows.attendees.reduce((sum, item) => sum + item.quantity, 0)).toBe(
      4,
    );
    expect(
      await fixture.prisma.checkinRecord.count({
        where: { invitationId: household.id },
      }),
    ).toBe(0);

    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${origins.admin}/`);
    for (const eventId of [fixture.ceremony.id, fixture.event.id]) {
      const report = await page.request.get(
        `/api/admin/reports/catering/live?eventId=${eventId}`,
      );
      expect(report.status()).toBe(200);
      expect((await report.json()).totals).toMatchObject({
        households: 1,
        namedInvitees: 3,
        events: [
          expect.objectContaining({ id: eventId, rsvpExpected: 4, actual: 0 }),
        ],
      });
    }
    await page.goto(`/rsvps/${rows.id}`);
    await expect(
      page
        .getByText("Synthetic first dietary preference", { exact: true })
        .first(),
    ).toBeVisible();

    const renamed = "Garden Gathering";
    const renamedBoth = `${reception} & ${renamed}`;
    await fixture.prisma.event.update({
      where: { id: fixture.ceremony.id },
      data: { name: renamed, slug: `rsvp-${randomUUID()}` },
    });
    await open(guest, household.publicCredential);
    await edit(guest);
    await expect(radio(guest, family)).toBeChecked();
    await expect(radio(guest, renamedBoth)).toBeChecked();
    expect((await read()).rsvp.eventSelections).toEqual(
      expect.arrayContaining(four.rsvp.eventSelections),
    );
    await expect(
      guest.getByRole("checkbox", { name: secondName, exact: true }),
    ).toBeChecked();
    await expect(
      guest.getByRole("checkbox", { name: childName, exact: true }),
    ).toBeChecked();
    await expect(
      guest.getByRole("spinbutton", { name: /anak tambahan/i }),
    ).toHaveValue("2");
    await notes(guest).fill("Synthetic updated dietary preference");
    await save(guest).click();
    await waitSaved(guest);
    const dietary = await persisted();
    expect(dietary.attendees.map(({ id }) => id).sort()).toEqual(
      rows.attendees.map(({ id }) => id).sort(),
    );
    expect(dietary.eventSelections.map(({ id }) => id).sort()).toEqual(
      rows.eventSelections.map(({ id }) => id).sort(),
    );
    const stale = await request.patch(household.url, {
      data: { expectedVersion: 3, dietaryNotes: "stale" },
    });
    expect(stale.status()).toBe(409);
    expect((await persisted()).dietaryNotes).toBe(
      "Synthetic updated dietary preference",
    );

    await edit(guest);
    await radio(guest, plusOne).check();
    await expect(
      guest.getByRole("checkbox", { name: "Sertakan anak" }),
    ).toHaveCount(0);
    await expect(guest.getByRole("spinbutton")).toHaveCount(0);
    await save(guest).click();
    await waitSaved(guest);
    expect((await read()).rsvp).toMatchObject({
      partyMode: "PLUS_ONE",
      attendeeQuantityTotal: 2,
      attendees: expect.arrayContaining([named(household.second.id), partner]),
    });
    await edit(guest);
    await radio(guest, alone).check();
    await save(guest).click();
    await waitSaved(guest);
    expect((await read()).rsvp).toMatchObject({
      partyMode: "ALONE",
      attendees: [named(household.second.id)],
      attendeeQuantityTotal: 1,
    });
    await edit(guest);
    await radio(guest, "Mohon maaf, tidak dapat hadir").check();
    await expect(radio(guest, renamedBoth)).toHaveCount(0);
    await expect(notes(guest)).toHaveCount(0);
    await save(guest).click();
    await waitSaved(guest, false);
    const declined = await read();
    expect(declined).toMatchObject({
      checkinPass: null,
      rsvp: {
        status: "DECLINED",
        attendees: [],
        eventSelections: [],
        dietaryNotes: null,
      },
    });
    expect(declined.rsvp).not.toHaveProperty("partyMode");
    expect(
      await fixture.prisma.invitee.count({
        where: { invitationId: household.id },
      }),
    ).toBe(3);
    expect(
      await fixture.prisma.checkinPass.count({
        where: { invitationId: household.id, status: "REVOKED" },
      }),
    ).toBe(1);
    expect(
      await fixture.prisma.checkinRecord.count({
        where: { invitationId: household.id },
      }),
    ).toBe(0);
  } finally {
    await guestContext.close();
    await fixture.remove();
  }
});

test("unsupported session catalogs block acceptance while preserving existing RSVP and diet edits", async ({
  page,
  request,
}) => {
  const fixture = await conditionalFixture();
  const third = await fixture.prisma.event.create({
    data: {
      name: "Late Gathering",
      slug: `rsvp-${randomUUID()}`,
      displayOrder: fixture.ceremony.displayOrder + 1,
    },
  });
  try {
    const saved = await fixture.createHousehold("Synthetic three sessions", {
      both: true,
      plus: false,
      pending: true,
    });
    const empty = await fixture.createHousehold("Synthetic no sessions", {
      both: false,
      plus: false,
      pending: true,
    });
    const accepted = {
      status: "ACCEPTED",
      expectedVersion: null,
      attendees: [named(saved.first.id)],
      eventSelections: [attending(fixture.event.id, 1)],
    };
    expect(
      (
        await request.put(saved.url, {
          data: { ...accepted, partyMode: "FAMILY" },
        })
      ).status(),
    ).toBe(200);
    await fixture.prisma.invitationEvent.create({
      data: { invitationId: saved.id, eventId: third.id },
    });
    await fixture.prisma.invitationEvent.deleteMany({
      where: { invitationId: empty.id },
    });
    const persisted = () =>
      fixture.prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: saved.id },
        include: { attendees: true, eventSelections: true, changes: true },
      });
    const passes = () =>
      fixture.prisma.checkinPass.findMany({
        where: { invitationId: saved.id },
      });
    const original = await persisted();
    const originalPasses = await passes();
    for (const [url, data] of [
      [saved.url, { ...accepted, expectedVersion: 1, partyMode: "ALONE" }],
      [saved.url, { ...accepted, expectedVersion: 1 }],
      [empty.url, { ...accepted, attendees: [named(empty.first.id)] }],
    ] as const) {
      const response = await request.put(url, { data });
      expect(response.status()).toBe(422);
      expect((await response.json()).error.code).toBe(
        "RSVP_SESSION_CONFIGURATION_UNSUPPORTED",
      );
    }
    expect(await persisted()).toEqual(original);
    expect(await passes()).toEqual(originalPasses);
    expect(
      await fixture.prisma.rSVP.count({ where: { invitationId: empty.id } }),
    ).toBe(0);
    const canonical = await request.get(saved.url);
    expect(canonical.status()).toBe(200);
    expect((await canonical.json()).rsvp.eventSelections).toEqual(
      accepted.eventSelections,
    );
    const diet = await request.patch(saved.url, {
      data: {
        expectedVersion: 1,
        dietaryNotes: "Synthetic diet with unsupported catalog",
      },
    });
    expect(diet.status()).toBe(200);
    const afterDiet = await persisted();
    expect(afterDiet.version).toBe(2);
    expect(afterDiet.attendees).toEqual(original.attendees);
    expect(afterDiet.eventSelections).toEqual(original.eventSelections);
    expect(await passes()).toEqual(originalPasses);

    await open(page, saved.publicCredential);
    await edit(page);
    await page.getByRole("button", { name: "Ubah Rincian Kehadiran" }).click();
    await radio(page, "Dengan senang hati hadir").check();
    await expect(
      page.getByText(/Sesi pernikahan untuk undangan ini perlu diperiksa/),
    ).toBeVisible();
    await expect(radio(page, family)).toHaveCount(0);
    await save(page).click();
    await expect(
      page.getByRole("form", { name: "RSVP Anda" }).getByRole("alert"),
    ).toContainText("Silakan pilih sesi pernikahan yang akan Anda hadiri.");
    expect((await persisted()).version).toBe(2);
    await radio(page, "Mohon maaf, tidak dapat hadir").check();
    await save(page).click();
    await waitSaved(page, false);
    expect((await persisted()).status).toBe("DECLINED");
    expect(await passes()).toMatchObject([
      { status: "REVOKED", revocationReason: "RSVP_DECLINED" },
    ]);
  } finally {
    await fixture.prisma.invitationEvent.deleteMany({
      where: { eventId: third.id },
    });
    await fixture.prisma.event.delete({ where: { id: third.id } });
    await fixture.remove();
  }
});

test("legacy counts and unnamed companions remain intact on diet edits until deliberate replacement", async ({
  page,
  request,
}, info) => {
  const fixture = await conditionalFixture();
  try {
    const legacy = await fixture.createHousehold("Synthetic legacy household", {
      both: true,
      plus: true,
      pending: false,
    });
    const rsvp = await fixture.prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: legacy.id },
    });
    // An old writer can change the roster while leaving the raw column intact.
    await fixture.prisma.rSVP.update({
      where: { id: rsvp.id },
      data: { publicPartyMode: "PLUS_ONE" },
    });
    await fixture.prisma.rSVPAttendee.create({
      data: { rsvpId: rsvp.id, attendeeType: "UNNAMED_COMPANION", quantity: 1 },
    });
    await fixture.prisma.rSVPEventSelection.create({
      data: { rsvpId: rsvp.id, ...attending(fixture.ceremony.id, 2) },
    });
    const persisted = () =>
      fixture.prisma.rSVP.findUniqueOrThrow({
        where: { id: rsvp.id },
        include: { attendees: true, eventSelections: true },
      });
    const before = await persisted();
    const canonicalBefore = await request.get(legacy.url);
    expect(canonicalBefore.status()).toBe(200);
    expect((await canonicalBefore.json()).rsvp).not.toHaveProperty("partyMode");
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page, legacy.publicCredential);
    await expect(page.getByText("Pendamping tanpa nama × 1")).toBeVisible();
    await expect(page.getByText(`${ceremony}: 2 orang`)).toBeVisible();
    await expect(page.getByText(`${reception}: 1 orang`)).toBeVisible();
    await edit(page);
    await expect(radio(page, family)).toHaveCount(0);
    await notes(page).fill("Synthetic legacy dietary change");
    await save(page).click();
    await waitSaved(page);
    const afterDiet = await persisted();
    expect(afterDiet).toMatchObject({
      version: 2,
      publicPartyMode: "PLUS_ONE",
      dietaryNotes: "Synthetic legacy dietary change",
    });
    expect(
      afterDiet.attendees.sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(before.attendees.sort((a, b) => a.id.localeCompare(b.id)));
    expect(
      afterDiet.eventSelections.sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual(before.eventSelections.sort((a, b) => a.id.localeCompare(b.id)));
    expect(
      await fixture.prisma.rsvpChangeEvent.findFirstOrThrow({
        where: { rsvpId: rsvp.id, revision: 2 },
      }),
    ).toMatchObject({
      changes: [expect.objectContaining({ field: "dietaryNotes" })],
    });
    const canonicalAfter = await request.get(legacy.url);
    expect(canonicalAfter.status()).toBe(200);
    expect((await canonicalAfter.json()).rsvp).not.toHaveProperty("partyMode");
    await open(page, legacy.publicCredential);
    await edit(page);
    await expect(notes(page)).toHaveValue("Synthetic legacy dietary change");
    await page.getByRole("button", { name: "Ubah Rincian Kehadiran" }).click();
    await expect(page.getByRole("note")).toContainText(
      "Semua sesi yang dipilih akan dihadiri oleh rombongan yang sama",
    );
    await expect(radio(page, "Dengan senang hati hadir")).not.toBeChecked();
    expect((await persisted()).version).toBe(2);
    await radio(page, "Dengan senang hati hadir").check();
    await radio(page, both).check();
    await radio(page, family).check();
    await check(page, firstName);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .getByRole("form", { name: "RSVP Anda" })
      .screenshot({ path: info.outputPath("replacement-desktop.png") });
    await save(page).click();
    await waitSaved(page);
    const replacement = await persisted();
    expect(replacement).toMatchObject({
      publicPartyMode: "FAMILY",
      version: 3,
    });
    expect(replacement.attendees).toMatchObject([
      { inviteeId: legacy.first.id, attendeeType: "NAMED_INVITEE" },
    ]);
    expect(
      replacement.eventSelections.map(
        ({ expectedAttendeeCount }) => expectedAttendeeCount,
      ),
    ).toEqual([1, 1]);
    await edit(page);
    await expect(radio(page, family)).toBeChecked();
    await expect(radio(page, alone)).not.toBeChecked();

    await fixture.prisma.checkinRecord.create({
      data: {
        invitationId: legacy.id,
        eventId: fixture.event.id,
        attendeeCount: 1,
        method: "MANUAL",
        confirmedByAdminUserId: fixture.owner.id,
      },
    });
    const afterCheckin = await request.patch(legacy.url, {
      data: { expectedVersion: 3, dietaryNotes: "blocked" },
    });
    expect(afterCheckin.status()).toBe(409);
    expect((await afterCheckin.json()).error.code).toBe(
      "RSVP_LOCKED_AFTER_CHECKIN",
    );
    expect((await persisted()).version).toBe(3);
  } finally {
    await fixture.remove();
  }
});

test("reception-only flow and real HTTP reject forged RSVP parties without writing rows", async ({
  page,
  request,
}) => {
  const fixture = await conditionalFixture();
  try {
    const household = await fixture.createHousehold(
      "Synthetic reception only",
      { both: false, plus: false, pending: true },
    );
    const outsider = await fixture.createHousehold(
      "Synthetic unrelated attendee",
      { both: true, plus: true, pending: true },
    );
    const valid = {
      status: "ACCEPTED",
      expectedVersion: null,
      partyMode: "ALONE",
      attendees: [named(household.second.id)],
      eventSelections: [attending(fixture.event.id, 1)],
    };
    const invalidCases = [
      [
        { ...valid, eventSelections: [attending(fixture.ceremony.id, 1)] },
        422,
        "EVENT_NOT_ALLOWED",
      ],
      [
        {
          ...valid,
          eventSelections: [
            ...valid.eventSelections,
            attending(fixture.ceremony.id, 1),
          ],
        },
        422,
        "EVENT_NOT_ALLOWED",
      ],
      [
        {
          ...valid,
          partyMode: "PLUS_ONE",
          attendees: [...valid.attendees, partner],
        },
        422,
        "PLUS_ONE_NOT_ALLOWED",
      ],
      [
        {
          ...valid,
          partyMode: "FAMILY",
          attendees: [...valid.attendees, children(3)],
        },
        422,
        "ADDITIONAL_CHILD_LIMIT_EXCEEDED",
      ],
      [
        {
          ...valid,
          partyMode: "FAMILY",
          attendees: [...valid.attendees, children(-1)],
        },
        400,
        "BAD_REQUEST",
      ],
      [
        {
          ...valid,
          partyMode: "FAMILY",
          attendees: [...valid.attendees, children(0.5)],
        },
        400,
        "BAD_REQUEST",
      ],
      [
        { ...valid, attendees: [named(outsider.second.id)] },
        422,
        "RSVP_ATTENDEE_INVALID",
      ],
      [
        {
          ...valid,
          attendees: [named(household.second.id), named(household.second.id)],
        },
        422,
        "RSVP_ATTENDEE_INVALID",
      ],
      [
        {
          ...valid,
          eventSelections: [...valid.eventSelections, ...valid.eventSelections],
        },
        422,
        "EVENT_NOT_ALLOWED",
      ],
      [
        {
          ...valid,
          attendees: [...valid.attendees, children(1)],
          eventSelections: [attending(fixture.event.id, 2)],
        },
        422,
        "RSVP_PARTY_INVALID",
      ],
      [{ ...valid, status: "DECLINED" }, 422, "RSVP_PARTY_INVALID"],
      [
        {
          ...valid,
          partyMode: "FAMILY",
          attendees: [named(household.first.id), named(household.second.id)],
          eventSelections: [attending(fixture.event.id, 1)],
        },
        422,
        "RSVP_SESSION_COUNTS_MISMATCH",
      ],
    ] as const;
    for (const [data, status, code] of invalidCases) {
      const response = await request.put(household.url, { data });
      expect(response.status(), code).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    const extraChild = await request.put(outsider.url, {
      data: {
        ...valid,
        partyMode: "PLUS_ONE",
        attendees: [named(outsider.first.id), partner, children(1)],
        eventSelections: [attending(fixture.event.id, 3)],
      },
    });
    expect(extraChild.status()).toBe(422);
    expect((await extraChild.json()).error.code).toBe("RSVP_PARTY_INVALID");
    const mismatchedLegacyWrite = await request.put(outsider.url, {
      data: {
        status: "ACCEPTED",
        expectedVersion: null,
        attendees: [named(outsider.first.id), named(outsider.second.id)],
        eventSelections: [
          attending(fixture.event.id, 2),
          attending(fixture.ceremony.id, 1),
        ],
      },
    });
    expect(mismatchedLegacyWrite.status()).toBe(422);
    expect((await mismatchedLegacyWrite.json()).error.code).toBe(
      "RSVP_SESSION_COUNTS_MISMATCH",
    );
    const forgedPatch = await request.patch(outsider.url, {
      data: { expectedVersion: 1, dietaryNotes: null, partyMode: "FAMILY" },
    });
    expect(forgedPatch.status()).toBe(400);
    expect(
      await fixture.prisma.rSVP.count({
        where: { invitationId: { in: [household.id, outsider.id] } },
      }),
    ).toBe(0);
    expect(
      await fixture.prisma.checkinPass.count({
        where: { invitationId: { in: [household.id, outsider.id] } },
      }),
    ).toBe(0);

    await open(page, household.publicCredential);
    await radio(page, "Dengan senang hati hadir").check();
    await expect(radio(page, both)).toHaveCount(0);
    await expect(radio(page, ceremony)).toHaveCount(0);
    await expect(page.getByText("Sesi untuk undangan ini:")).toContainText(
      reception,
    );
    await expect(radio(page, plusOne)).toHaveCount(0);
    await radio(page, "Mohon maaf, tidak dapat hadir").check();
    await expect(notes(page)).toHaveCount(0);
    await save(page, true).click();
    await waitSaved(page, false);
    expect(
      await fixture.prisma.invitee.count({
        where: { invitationId: household.id },
      }),
    ).toBe(3);
  } finally {
    await fixture.remove();
  }
});
