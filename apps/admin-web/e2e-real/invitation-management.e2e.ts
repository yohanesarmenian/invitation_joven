import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";

const origins = runnerOrigins();

test("OWNER invitation workspace filters saved sessions and shares only the current authorized link", async ({
  page,
  context,
}, testInfo) => {
  const fixture = await createWorkflowFixture();
  const code = randomUUID().slice(0, 8);
  const extraEventIds: string[] = [];
  try {
    const createEvent = async (name: string) => {
      const event = await fixture.prisma.event.create({
        data: {
          displayOrder: fixture.event.displayOrder + extraEventIds.length + 1,
          name,
          slug: `management-${randomUUID()}`,
        },
      });
      extraEventIds.push(event.id);
      return event;
    };
    await fixture.prisma.event.update({
      where: { id: fixture.event.id },
      data: { name: "Ceremony at North Hall" },
    });
    const otherEvent = await createEvent(
      "Additional wedding session " + "longname".repeat(15),
    );
    const third = await createEvent("Third session");
    const first = await fixture.household(`A Eligible household ${code}`, {
      pending: true,
    });
    const pair = await fixture.household(`B Pair household ${code}`);
    const legacy = await fixture.household(`C Legacy household ${code}`, {
      pending: true,
    });
    const archived = await fixture.household(`D Archived household ${code}`, {
      pending: true,
    });
    const zero = await fixture.household(`E Zero sessions ${code}`, {
      pending: true,
    });
    const last = await fixture.household(
      `Z ${"LongHousehold".repeat(12)} ${code}`,
      { pending: true },
    );
    await fixture.prisma.invitationEvent.createMany({
      data: [
        { invitationId: pair.id, eventId: otherEvent.id },
        { invitationId: legacy.id, eventId: otherEvent.id },
        { invitationId: legacy.id, eventId: third.id },
      ],
    });
    await fixture.prisma.invitationEvent.deleteMany({
      where: { invitationId: zero.id },
    });
    await fixture.prisma.invitation.update({
      where: { id: archived.id },
      data: {
        status: "ARCHIVED",
        archivedAt: new Date(),
      },
    });
    await fixture.prisma.invitation.update({
      where: { id: pair.id },
      data: {
        openCount: 1,
        lastOpenedAt: new Date(),
      },
    });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${origins.admin}/`);

    const privateReads: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/public-url")) privateReads.push(path);
    });
    const baseQuery = `/invitations?search=${code}&sortBy=displayName&sortOrder=asc`;
    await page.goto(baseQuery);
    const results = page.getByRole("region", { name: "Invitation results" });
    const row = (name: string) =>
      results.getByRole("row").filter({ hasText: name });
    await expect(results).toContainText("6 invitations matching");
    const overview = page.getByRole("region", {
      name: "Active invitation overview",
    });
    const overviewBefore = await overview.innerText();
    await expect(row(legacy.name)).toContainText(
      "Legacy eligibility exceeds two sessions",
    );
    await expect(
      row(zero.name).getByRole("link", { name: "Review eligibility" }),
    ).toHaveAttribute("href", `/invitations/${zero.id}#eligible-events-title`);
    await expect(
      row(archived.name).getByRole("button", { name: "Copy link" }),
    ).toHaveCount(0);
    expect(privateReads).toEqual([]);
    expect((await page.content()).includes(first.publicCredential)).toBe(false);

    for (const width of [320, 375, 412, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await expect(
        row(last.name).getByRole("button", { name: "Copy link" }),
      ).toBeVisible();
      if (width >= 1280) {
        const bounds = await row(pair.name)
          .locator(".invitation-eligibility-cell")
          .boundingBox();
        expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(150);
      }
      if (process.env.UX02_A2_SCREENSHOTS === "1") {
        await page.screenshot({
          path: testInfo.outputPath(`invitation-list-${width}.png`),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 768, height: 900 });
    const largeText = await page.addStyleTag({
      content: "html { font-size: 200% !important; }",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await largeText.evaluate((element) =>
      element.parentNode?.removeChild(element),
    );

    const history = row(pair.name).getByText("History and deadline", {
      exact: true,
    });
    await history.focus();
    await history.press("Enter");
    await expect(
      row(pair.name).getByText("RSVP deadline", { exact: true }),
    ).toBeVisible();
    await history.press("Enter");

    await page.getByLabel("Match", { exact: true }).selectOption("exact");
    await page
      .getByLabel("Session", { exact: true })
      .selectOption(fixture.event.id);
    await page
      .getByLabel("Second session (optional)")
      .selectOption(otherEvent.id);
    await page.getByLabel("Opening activity").selectOption("opened");
    await page
      .getByRole("button", { name: "Apply search and filters" })
      .click();
    await expect(results).toContainText("1 invitation matching");
    await expect(results.getByRole("link", { name: pair.name })).toBeVisible();
    await expect(page.locator("#invitation-results-heading")).toBeFocused();
    await expect(overview).toHaveText(overviewBefore, { useInnerText: true });
    await page.reload();
    await expect(page.getByLabel("Second session (optional)")).toHaveValue(
      otherEvent.id,
    );

    await results.getByRole("link", { name: pair.name }).click();
    await page
      .getByRole("navigation", { name: "Invitation detail sections" })
      .getByRole("link", { name: "Activity and RSVP" })
      .click();
    await expect(page.locator("#invitation-activity")).toBeFocused();
    await expect(page.getByText("Attending per saved RSVP")).toBeVisible();
    const events = page.getByRole("group", {
      name: "Proposed eligible sessions",
    });
    await events.getByRole("checkbox", { name: otherEvent.name }).uncheck();
    await page
      .getByRole("navigation", { name: "Invitation detail sections" })
      .getByRole("link", { name: "Guests and sessions" })
      .click();
    await expect(
      events.getByRole("checkbox", { name: otherEvent.name }),
    ).not.toBeChecked();
    expect(
      await fixture.prisma.invitationEvent.count({
        where: { invitationId: pair.id },
      }),
    ).toBe(2);
    if (process.env.UX02_A2_SCREENSHOTS === "1") {
      for (const width of [320, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({
          path: testInfo.outputPath(`invitation-detail-${width}.png`),
          fullPage: true,
        });
      }
    }

    await page.goto(baseQuery);
    const session = await (await page.request.get("/api/admin/auth/me")).json();
    const headers = {
      Origin: origins.admin,
      "X-CSRF-Token": session.csrfToken,
    };
    const rotate = await page.request.post(
      `/api/admin/invitations/${first.id}/regenerate-token`,
      {
        headers,
        data: { expectedTokenVersion: 1 },
      },
    );
    expect(rotate.status()).toBe(200);
    const currentUrl: string = (await rotate.json()).publicUrl;
    expect(currentUrl.endsWith(first.publicCredential)).toBe(false);

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await row(first.name).getByRole("button", { name: "Copy link" }).click();
    await expect(row(first.name).getByRole("status")).toHaveText(
      "Invitation link copied.",
    );
    expect(
      (await page.evaluate(() => navigator.clipboard.readText())) ===
        currentUrl,
    ).toBe(true);
    expect(privateReads).toEqual([
      `/api/admin/invitations/${first.id}/public-url`,
    ]);
    expect(
      await page.evaluate(
        (link) =>
          !Object.values(sessionStorage).some((value) =>
            value.includes(link),
          ) &&
          !Object.values(localStorage).some((value) => value.includes(link)),
        currentUrl,
      ),
    ).toBe(true);

    const archive = await page.request.post(
      `/api/admin/invitations/${first.id}/archive`,
      {
        headers,
        data: {},
      },
    );
    expect(archive.status()).toBe(200);
    await row(first.name)
      .getByRole("button", { name: "Prepare WhatsApp" })
      .click();
    await expect(row(first.name).getByRole("alert")).toContainText(
      "now archived",
    );
    await expect(
      row(first.name).getByRole("link", { name: "Open WhatsApp" }),
    ).toHaveCount(0);

    await fixture.prisma.adminSession.deleteMany({
      where: { adminUserId: fixture.owner.id },
    });
    await row(pair.name).getByRole("button", { name: "Copy link" }).click();
    await expect(page).toHaveURL(/\/login\?session=ended$/);
  } finally {
    await fixture.prisma.invitationEvent.deleteMany({
      where: { eventId: { in: extraEventIds } },
    });
    await fixture.prisma.event.deleteMany({
      where: { id: { in: extraEventIds } },
    });
    await fixture.cleanup();
  }
});
