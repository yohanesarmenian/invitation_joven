import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";

const origins = runnerOrigins();
const savedMessage = "Thank you for your message";

async function openInvitation(page: Page, credential: string) {
  await page.goto(`${origins.invitation}/i/${credential}`);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
}

test("guest message receipt survives a lost response, returning to the hero and reopening", async ({
  page,
  request,
}, testInfo) => {
  const fixture = await createWorkflowFixture();
  try {
    const guest = await fixture.household("Synthetic receipt household", {
      pending: true,
    });
    const other = await fixture.household("Synthetic unrelated household", {
      pending: true,
    });
    await openInvitation(page, guest.publicCredential);
    const heading = page.getByRole("heading", {
      name: savedMessage,
      exact: true,
    });
    const message = page.getByRole("textbox", { name: /Your message/ });
    const send = page.getByRole("button", {
      name: "Send Message",
      exact: true,
    });
    const section = page.locator(".guest-message-section");
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const title = page.locator("#invitation-hero-title");
      const geometry = await title.evaluate(async (element) => {
        await document.fonts.ready;
        const parts = Array.from(element.children, (child) =>
          child.getBoundingClientRect().toJSON(),
        );
        return {
          parts,
          viewport: innerWidth,
          fits: document.documentElement.scrollWidth <= innerWidth + 1,
        };
      });
      expect(geometry.fits).toBe(true);
      expect(geometry.parts).toHaveLength(3);
      if (width < 700) {
        for (const [index, part] of geometry.parts.entries()) {
          expect(
            Math.abs(part.left + part.width / 2 - width / 2),
          ).toBeLessThanOrEqual(2);
          if (index > 0)
            expect(part.top).toBeGreaterThan(geometry.parts[index - 1]!.top);
        }
      } else {
        expect(geometry.parts[0]!.right).toBeLessThan(geometry.parts[1]!.left);
        expect(geometry.parts[1]!.right).toBeLessThan(geometry.parts[2]!.left);
        expect(
          Math.abs(geometry.parts[0]!.top - geometry.parts[2]!.top),
        ).toBeLessThanOrEqual(2);
      }
      await page.locator(".invitation-hero").screenshot({
        path: testInfo.outputPath(`hero-${width}.png`),
      });
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(
      section.getByRole("heading", { name: /Leave a Message/ }),
    ).toBeVisible();
    const content = "Synthetic first message\nExact second line";
    await message.fill(content);
    let lost = 0;
    const pattern = `${origins.invitation}/i/**`;
    await page.route(pattern, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      lost++;
      await route.fetch({ maxRetries: 0 });
      await route.abort();
    });
    await send.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
    await expect(section.getByRole("alert")).toContainText(
      "We couldn’t confirm the save yet",
    );
    await expect(message).toHaveValue(content);
    expect(lost).toBe(1);
    const row = await fixture.prisma.guestMessage.findFirstOrThrow({
      where: { invitationId: guest.id },
    });
    expect(row).toMatchObject({
      invitationId: guest.id,
      authorName: null,
      message: content,
    });
    const receiptUrl = (credential: string) =>
      `${origins.api}/api/public/invitations/${credential}/messages/receipt`;
    const headers = { "x-message-submission-id": row.id };
    const receipt = await request.get(receiptUrl(guest.publicCredential), {
      headers,
    });
    expect(receipt.status()).toBe(200);
    expect(await receipt.json()).toEqual({
      message: { createdAt: row.createdAt.toISOString() },
    });
    expect(
      (
        await request.get(receiptUrl(guest.publicCredential), {
          headers: { "x-message-submission-id": randomUUID() },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(receiptUrl(other.publicCredential), { headers })
      ).status(),
    ).toBe(404);
    await page.unroute(pattern);
    await page.getByRole("button", { name: "Retry same message" }).click();
    await expect(heading).toBeVisible();
    expect(
      await fixture.prisma.guestMessage.count({
        where: { invitationId: guest.id },
      }),
    ).toBe(1);
    await page.getByRole("button", { name: "Back to Invitation" }).click();
    await expect(page.locator("#invitation-hero-title")).toBeFocused();
    await section.scrollIntoViewIfNeeded();
    await expect(section).toContainText(
      "Your message was saved for the bride and groom.",
    );
    await expect(message).toHaveCount(0);
    await openInvitation(page, guest.publicCredential);
    await expect(heading).toBeVisible();
    await expect(message).toHaveCount(0);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await section.evaluate((node) => {
          const limits = node.getBoundingClientRect();
          return Array.from(node.querySelectorAll("h2, p, button")).every(
            (element) => {
              const bounds = element.getBoundingClientRect();
              return (
                bounds.left >= limits.left - 1 &&
                bounds.right <= limits.right + 1 &&
                element.scrollWidth <= element.clientWidth + 1
              );
            },
          );
        }),
      ).toBe(true);
      await section.screenshot({
        path: testInfo.outputPath(`saved-message-${width}.png`),
      });
    }
    const author = section.getByRole("textbox", { name: /Your name/ });
    const secondDraft = "Synthetic deliberate second message";
    const focusedAtMount = await page
      .getByRole("button", { name: "Write another message" })
      .evaluate((button: HTMLButtonElement) => {
        const editor = button.closest(".guest-message-form");
        if (!editor) throw new Error("Missing guest message editor");
        // Check the first committed form, before a later animation frame can focus it.
        return new Promise<boolean>((resolve) => {
          const observer = new MutationObserver(() => {
            const field = editor.querySelector("form input");
            if (!field) return;
            observer.disconnect();
            resolve(document.activeElement === field);
          });
          observer.observe(editor, { childList: true, subtree: true });
          button.click();
        });
      });
    expect(focusedAtMount).toBe(true);
    await expect(message).toHaveValue("");
    await message.fill(secondDraft);
    await expect(author).toHaveValue("");
    await expect(message).toBeFocused();
    await expect(message).toHaveValue(secondDraft);
    await expect(
      section.getByText(`${secondDraft.length} / 1000 characters`, {
        exact: false,
      }),
    ).toBeVisible();
    await fixture.prisma.invitation.update({
      where: { id: guest.id },
      data: { status: "ARCHIVED" },
    });
    try {
      await send.click();
      await expect(section.getByRole("alert")).toContainText(
        "This invitation is currently unavailable.",
      );
      await expect(message).toHaveValue(secondDraft);
      expect(
        await fixture.prisma.guestMessage.count({
          where: { invitationId: guest.id },
        }),
      ).toBe(1);
    } finally {
      await fixture.prisma.invitation.update({
        where: { id: guest.id },
        data: { status: "ACTIVE" },
      });
    }
    await page.getByRole("button", { name: "Send Message Again" }).click();
    await expect(heading).toBeVisible();
    const messages = await fixture.prisma.guestMessage.findMany({
      where: { invitationId: guest.id },
    });
    expect(messages.map((item) => item.message)).toEqual(
      expect.arrayContaining([content, secondDraft]),
    );
    expect(messages.every((item) => item.invitationId === guest.id)).toBe(true);
    expect(messages).toHaveLength(2);
    expect(
      await fixture.prisma.guestMessage.count({
        where: { invitationId: other.id },
      }),
    ).toBe(0);
  } finally {
    await fixture.cleanup();
  }
});

test("OWNER assigns wedding sessions and RSVP preserves named guests, counts and dietary edits", async ({
  page,
  browser,
  request,
}) => {
  const fixture = await createWorkflowFixture();
  const ceremonySlug = `ceremony-${randomUUID()}`;
  const unrelatedSlug = `unrelated-${randomUUID()}`;
  const householdName = `Synthetic two-session household ${randomUUID()}`;
  const guestContext = await browser.newContext({
    viewport: { width: 375, height: 900 },
  });
  try {
    const receptionOnly = await fixture.household("Synthetic reception only", {
      pending: true,
    });
    const receptionName = "Resepsi";
    const ceremonyName = "Pemberkatan";
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${origins.admin}/`);
    await page.goto("/events");
    const eventPicker = page.getByLabel("Event to edit");
    await eventPicker.selectOption(fixture.event.id);
    await page.getByLabel("Event name").fill(receptionName);
    await page.getByRole("button", { name: "Save event" }).click();
    await expect(page.getByText("Event saved successfully.")).toBeVisible();
    await eventPicker.selectOption("");
    await page.getByLabel("Event name").fill(ceremonyName);
    await page.getByLabel("Slug", { exact: true }).fill(ceremonySlug);
    await page.getByLabel("Venue name").fill("Synthetic ceremony venue");
    await page
      .getByLabel("Address", { exact: true })
      .fill("Synthetic ceremony address");
    await page.getByRole("button", { name: "Save event" }).click();
    await expect(page.getByText("Event saved successfully.")).toBeVisible();
    const ceremony = await fixture.prisma.event.findUniqueOrThrow({
      where: { slug: ceremonySlug },
    });
    await page.reload();
    await eventPicker.selectOption(ceremony.id);
    await expect(page.getByLabel("Venue name")).toHaveValue(
      "Synthetic ceremony venue",
    );
    await eventPicker.selectOption(fixture.event.id);
    await expect(page.getByLabel("Event name")).toHaveValue(receptionName);
    await expect(page.getByLabel("Venue name")).toHaveValue("Synthetic venue");
    const unrelated = await fixture.prisma.event.create({
      data: {
        name: "Synthetic ineligible session",
        slug: unrelatedSlug,
        displayOrder: 5,
      },
    });
    const catering = async () => {
      const response = await page.request.get(
        "/api/admin/reports/catering/live",
      );
      expect(response.status()).toBe(200);
      return (await response.json()).totals;
    };
    const reportBefore = await catering();
    await page.goto("/invitations/new");
    await expect(
      page.getByRole("group", { name: "Wedding sessions" }),
    ).toBeVisible();
    const ceremonyOption = page.getByRole("checkbox", {
      name: ceremonyName,
      exact: true,
    });
    const receptionOption = page.getByRole("checkbox", {
      name: receptionName,
      exact: true,
    });
    await expect(ceremonyOption).not.toBeChecked();
    await expect(receptionOption).not.toBeChecked();
    await ceremonyOption.check();
    await receptionOption.check();
    await page.locator("#invitee-0").fill("Synthetic Named A");
    await page.getByRole("button", { name: /Add.*guest/i }).click();
    await page.locator("#invitee-1").fill("Synthetic Named B");
    await page.getByText("Household name (optional)", { exact: true }).click();
    await page
      .getByLabel("Invitation / household name (optional)")
      .fill(householdName);
    await page
      .getByText("Greeting, additional guests, children and RSVP deadline", {
        exact: true,
      })
      .click();
    await page.getByLabel("Allow one plus-one guest").check();
    await page
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Invitation created", exact: true }),
    ).toBeVisible();
    const invitation = await fixture.prisma.invitation.findFirstOrThrow({
      where: { displayName: householdName },
      include: { invitees: true, invitationEvents: true },
    });
    const eventIds = [ceremony.id, fixture.event.id];
    expect(
      invitation.invitationEvents.map((entry) => entry.eventId).sort(),
    ).toEqual([...eventIds].sort());
    const link = await page.getByLabel("Public invitation link").inputValue();
    expect(new URL(link).origin === origins.invitation).toBe(true);
    const credential = new URL(link).pathname.split("/").at(-1)!;
    const beforeEligibility = () =>
      fixture.prisma.invitationEvent.findMany({
        where: { invitationId: receptionOnly.id },
        select: { eventId: true },
      });
    expect(await beforeEligibility()).toEqual([{ eventId: fixture.event.id }]);
    const guest = await guestContext.newPage();
    const rsvpUrl = (value: string) =>
      `${origins.api}/api/public/invitations/${value}/rsvp`;
    const readRsvp = async () => {
      const result = await request.get(rsvpUrl(credential));
      expect(result.status()).toBe(200);
      return (await result.json()).rsvp;
    };
    await openInvitation(guest, credential);
    await expect(
      guest.getByRole("heading", { name: ceremonyName, exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: receptionName, exact: true }),
    ).toBeVisible();
    await expect(guest.getByText(unrelated.name, { exact: true })).toHaveCount(
      0,
    );
    const namedA = guest.getByRole("radio", {
      name: "Synthetic Named A",
      exact: true,
    });
    const namedB = guest.getByRole("radio", {
      name: "Synthetic Named B",
      exact: true,
    });
    const withPlusOne = guest.getByRole("radio", {
      name: "I’ll bring a plus one",
      exact: true,
    });
    const alone = guest.getByRole("radio", {
      name: "I’ll attend on my own",
      exact: true,
    });
    const bothSessions = guest.getByRole("radio", {
      name: /Pemberkatan & Resepsi|Resepsi & Pemberkatan/,
      exact: true,
    });
    await guest.getByRole("radio", { name: "Joyfully Accept" }).check();
    await bothSessions.check();
    await alone.check();
    await namedB.check();
    await guest
      .getByRole("button", { name: "Submit RSVP", exact: true })
      .click();
    await expect(
      guest.getByText("Synthetic Named B × 1", { exact: true }),
    ).toBeVisible();
    const first = await readRsvp();
    const namedId = invitation.invitees.find(
      ({ fullName }) => fullName === "Synthetic Named B",
    )!.id;
    expect(first).toMatchObject({
      version: 1,
      attendeeQuantityTotal: 1,
      attendees: [{ type: "NAMED_INVITEE", inviteeId: namedId, quantity: 1 }],
      eventSelections: expect.arrayContaining(
        eventIds.map((eventId) => ({
          eventId,
          attending: true,
          expectedAttendeeCount: 1,
        })),
      ),
    });
    const edit = () => guest.getByRole("button", { name: "Edit RSVP" }).click();
    const save = () =>
      guest.getByRole("button", { name: "Save Changes", exact: true }).click();
    const dietary = guest.getByLabel("Dietary requirements (optional)");
    await edit();
    await expect(namedA).not.toBeChecked();
    await expect(namedB).toBeChecked();
    await withPlusOne.check();
    await save();
    await expect(
      guest.getByText("Expected guests: 2", { exact: true }),
    ).toBeVisible();
    const withCompanion = await readRsvp();
    expect(
      withCompanion.attendees.map((item: { type: string }) => item.type).sort(),
    ).toEqual(["NAMED_INVITEE", "PLUS_ONE"]);
    expect(withCompanion.eventSelections).toEqual(
      expect.arrayContaining([
        { eventId: ceremony.id, attending: true, expectedAttendeeCount: 2 },
        {
          eventId: fixture.event.id,
          attending: true,
          expectedAttendeeCount: 2,
        },
      ]),
    );
    await edit();
    await alone.check();
    await expect(namedB).toBeChecked();
    await expect(bothSessions).toBeChecked();
    await save();
    await expect(
      guest.getByText("Expected guests: 1", { exact: true }),
    ).toBeVisible();
    await edit();
    await dietary.fill("Synthetic no peanuts");
    await save();
    await expect(
      guest.getByText("Dietary requirements: Synthetic no peanuts", {
        exact: true,
      }),
    ).toBeVisible();
    const latest = await readRsvp();
    expect(latest).toMatchObject({
      version: 4,
      dietaryNotes: "Synthetic no peanuts",
      attendees: first.attendees,
      eventSelections: first.eventSelections,
    });
    const db = await fixture.prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: invitation.id },
      include: { attendees: true, eventSelections: true },
    });
    expect(db).toMatchObject({ version: 4, dietaryNotes: latest.dietaryNotes });
    expect(db.attendees).toHaveLength(1);
    expect(db.attendees[0]).toMatchObject({
      inviteeId: namedId,
      attendeeType: "NAMED_INVITEE",
      quantity: 1,
    });
    expect(db.eventSelections).toHaveLength(2);
    expect(db.eventSelections).toEqual(
      expect.arrayContaining(
        eventIds.map((eventId) =>
          expect.objectContaining({
            eventId,
            attending: true,
            expectedAttendeeCount: 1,
          }),
        ),
      ),
    );
    expect(
      await fixture.prisma.checkinRecord.count({
        where: { invitationId: invitation.id },
      }),
    ).toBe(0);
    const stale = await request.put(rsvpUrl(credential), {
      data: {
        status: "ACCEPTED",
        attendees: first.attendees,
        eventSelections: first.eventSelections,
        dietaryNotes: "Ignored stale edit",
        expectedVersion: 1,
      },
    });
    expect(stale.status()).toBe(409);
    expect(await readRsvp()).toEqual(latest);
    await openInvitation(guest, credential);
    await expect(
      guest.getByText("Synthetic Named B × 1", { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByText("Dietary requirements: Synthetic no peanuts", {
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(`/rsvps/${db.id}`);
    await expect(
      page.getByText("Synthetic no peanuts", { exact: true }).first(),
    ).toBeVisible();
    const reportAfter = await catering();
    expect(reportAfter.households - reportBefore.households).toBe(1);
    expect(reportAfter.namedInvitees - reportBefore.namedInvitees).toBe(2);
    expect(reportAfter.events).toEqual(
      expect.arrayContaining(
        eventIds.map((id) =>
          expect.objectContaining({ id, rsvpExpected: 1, actual: 0 }),
        ),
      ),
    );
    const receptionGuest = await guestContext.newPage();
    await openInvitation(receptionGuest, receptionOnly.publicCredential);
    await expect(
      receptionGuest.getByRole("heading", { name: ceremonyName, exact: true }),
    ).toHaveCount(0);
    await receptionGuest
      .getByRole("radio", { name: "Joyfully Accept" })
      .check();
    await expect(
      receptionGuest.getByText("is selected for this invitation."),
    ).toContainText("Resepsi");
    await expect(
      receptionGuest.getByRole("radio", {
        name: "Pemberkatan",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      receptionGuest.getByRole("radio", {
        name: "I’ll bring a plus one",
      }),
    ).toHaveCount(0);
    const receptionInvitee = await fixture.prisma.invitee.findFirstOrThrow({
      where: { invitationId: receptionOnly.id },
    });
    const ownerInvitee = {
      type: "NAMED_INVITEE",
      inviteeId: receptionInvitee.id,
      quantity: 1,
    };
    for (const [attendees, eventId, code] of [
      [
        [ownerInvitee, { type: "PLUS_ONE", quantity: 1 }],
        fixture.event.id,
        "PLUS_ONE_NOT_ALLOWED",
      ],
      [[ownerInvitee], ceremony.id, "EVENT_NOT_ALLOWED"],
      [[ownerInvitee], unrelated.id, "EVENT_NOT_ALLOWED"],
      [
        [{ type: "NAMED_INVITEE", inviteeId: namedId, quantity: 1 }],
        fixture.event.id,
        "RSVP_ATTENDEE_INVALID",
      ],
    ] as const) {
      const result = await request.put(
        rsvpUrl(receptionOnly.publicCredential),
        {
          data: {
            status: "ACCEPTED",
            attendees,
            eventSelections: [
              { eventId, expectedAttendeeCount: 1, attending: true },
            ],
            expectedVersion: null,
            dietaryNotes: null,
          },
        },
      );
      expect(result.status()).toBe(422);
      expect((await result.json()).error.code).toBe(code);
    }
    expect(
      await fixture.prisma.rSVP.count({
        where: { invitationId: receptionOnly.id },
      }),
    ).toBe(0);
    await page.goto(`/invitations/${receptionOnly.id}`);
    await page.getByRole("checkbox", { name: /Pemberkatan/ }).check();
    await page.getByRole("button", { name: "Save event eligibility" }).click();
    await expect(
      page.getByText("Event eligibility updated.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await beforeEligibility()).map(({ eventId }) => eventId).sort(),
      )
      .toEqual([...eventIds].sort());
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: /Pemberkatan/ }),
    ).toBeChecked();
  } finally {
    await guestContext.close();
    const created = await fixture.prisma.invitation.findMany({
      where: { displayName: householdName },
      select: { id: true },
    });
    const ids = created.map(({ id }) => id);
    await fixture.prisma.checkinPass.deleteMany({
      where: { invitationId: { in: ids } },
    });
    await fixture.prisma.rSVP.deleteMany({
      where: { invitationId: { in: ids } },
    });
    await fixture.prisma.invitee.deleteMany({
      where: { invitationId: { in: ids } },
    });
    await fixture.prisma.invitationEvent.deleteMany({
      where: { invitationId: { in: ids } },
    });
    await fixture.prisma.invitation.deleteMany({ where: { id: { in: ids } } });
    const extra = await fixture.prisma.event.findMany({
      where: { slug: { in: [ceremonySlug, unrelatedSlug] } },
    });
    // The fixture owns the pre-existing reception-only invite and its links.
    await fixture.prisma.invitationEvent.deleteMany({
      where: { eventId: { in: extra.map(({ id }) => id) } },
    });
    await fixture.prisma.event.deleteMany({
      where: { slug: { in: [ceremonySlug, unrelatedSlug] } },
    });
    await fixture.cleanup();
  }
});
