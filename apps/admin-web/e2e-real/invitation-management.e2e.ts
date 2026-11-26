import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";

const origins = runnerOrigins();

async function signIn(
  page: Page,
  fixture: Awaited<ReturnType<typeof createWorkflowFixture>>,
) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${origins.admin}/`);
}

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
      row(first.name).getByRole("button", { name: "Open WhatsApp" }),
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

test("applied eligibility controls follow the real query through delayed navigation and history", async ({
  page,
}) => {
  const fixture = await createWorkflowFixture();
  const extraEvents: string[] = [];
  const delayedRequest = Promise.withResolvers<void>();
  const resumeRequest = Promise.withResolvers<void>();
  try {
    async function addEvent(name: string, displayOrder: number) {
      const event = await fixture.prisma.event.create({
        data: { name, slug: randomUUID(), displayOrder },
      });
      extraEvents.push(event.id);
      return event.id;
    }
    const eventA = fixture.event.id;
    const eventB = await addEvent("Filter session B", 20);
    const eventC = await addEvent("Filter session C", 21);
    const search = "Filter " + randomUUID().slice(0, 8);
    const a = await fixture.household(search + " A", { pending: true });
    const ab = await fixture.household(search + " AB", { pending: true });
    const abc = await fixture.household(search + " ABC", { pending: true });
    const zero = await fixture.household(search + " Zero", { pending: true });
    await fixture.prisma.invitationEvent.createMany({
      data: [
        { invitationId: ab.id, eventId: eventB },
        { invitationId: abc.id, eventId: eventB },
        { invitationId: abc.id, eventId: eventC },
      ],
    });
    await fixture.prisma.invitationEvent.deleteMany({
      where: { invitationId: zero.id },
    });
    await fixture.prisma.invitation.update({
      where: { id: abc.id },
      data: {
        openCount: 1,
        firstOpenedAt: new Date(),
        lastOpenedAt: new Date(),
      },
    });
    await signIn(page, fixture);
    const list = new URLSearchParams({
      search,
      sortBy: "displayName",
      sortOrder: "asc",
    });
    await page.goto(`/invitations?${list}`);

    const match = page.getByLabel("Match", { exact: true });
    const first = page.getByLabel("Session", { exact: true });
    const second = page.getByLabel("Second session (optional)");
    const apply = page.getByRole("button", {
      name: "Apply search and filters",
    });
    const form = page.getByRole("form", {
      name: "Search and filter invitations",
    });
    const searchField = form.getByLabel("Search invitations");
    const results = page.getByRole("region", { name: "Invitation results" });
    async function expectApplied({
      mode,
      selected = [],
      rows,
      total = rows.length,
      pageNumber = "1",
    }: {
      mode: string;
      selected?: string[];
      rows: { id: string; name: string }[];
      total?: number;
      pageNumber?: string;
    }) {
      await expect(page).toHaveURL(
        (url) =>
          (url.searchParams.get("eligibility") ?? "") === mode &&
          (url.searchParams.get("page") ?? "1") === pageNumber &&
          (url.searchParams.get("eventId") ?? "") === (selected[0] ?? "") &&
          (url.searchParams.get("secondEventId") ?? "") === (selected[1] ?? ""),
      );
      await expect(apply).toBeEnabled();
      await expect(match).toHaveValue(mode);
      if (selected.length) {
        await expect(first).toHaveValue(selected[0]!);
        await expect(second).toHaveValue(selected[1] ?? "");
      } else {
        await expect(first).toHaveCount(0);
        await expect(second).toHaveCount(0);
      }
      const query = new URL(page.url()).searchParams;
      expect(query.get("eligibility") ?? "").toBe(mode);
      expect(query.get("page") ?? "1").toBe(pageNumber);
      expect(query.get("eventId") ?? "").toBe(selected[0] ?? "");
      expect(query.get("secondEventId") ?? "").toBe(selected[1] ?? "");
      await expect(results).toContainText(
        `${total} ${total === 1 ? "invitation" : "invitations"} matching`,
      );
      await expect(results.locator(".invitation-name")).toHaveText(
        rows.map(({ name }) => name),
      );
      const authoritative = await page.request.get(
        `/api/admin/invitations?${query}`,
      );
      expect(authoritative.status()).toBe(200);
      const body = await authoritative.json();
      expect(body.page.totalItems).toBe(total);
      expect(body.items.map(({ id }: { id: string }) => id)).toEqual(
        rows.map(({ id }) => id),
      );
    }

    const isExactNavigation = (url: URL) =>
      url.pathname === "/invitations" &&
      url.searchParams.get("eligibility") === "exact";
    const submittedQueries: URLSearchParams[] = [];
    const recordSubmission = (request: { url(): string }) => {
      const url = new URL(request.url());
      if (isExactNavigation(url)) submittedQueries.push(url.searchParams);
    };
    page.on("request", recordSubmission);
    await page.route(
      isExactNavigation,
      async (route) => {
        const response = await route.fetch();
        delayedRequest.resolve();
        await resumeRequest.promise;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await expect(apply).toBeEnabled();
    await match.selectOption("exact");
    await expect(match).toHaveValue("exact");
    await first.selectOption(eventA);
    await expect(results).toContainText("4 invitations matching");
    await searchField.press("Enter");
    await delayedRequest.promise;
    await expect(
      form.getByRole("button", { name: /Loading|Applying filters/ }),
    ).toBeDisabled();
    for (const control of await form.locator("input, select").all()) {
      await expect(control).toBeDisabled();
    }
    await expect(form.locator("input, select")).toHaveCount(10);
    await expect(form.getByRole("status")).toContainText("Applying filters");
    const reset = form.getByRole("link", { name: "Reset all" });
    await expect(reset).toBeDisabled();
    expect(await reset.getAttribute("href")).toBeNull();
    await searchField.evaluate((input) => input.focus());
    await page.keyboard.type("Search that must not be accepted");
    await match.evaluate((select) => select.focus());
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await reset.dispatchEvent("click");
    await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
    await expect(searchField).toHaveValue(search);
    await expect(match).toHaveValue("exact");
    await expect(first).toHaveValue(eventA);
    await expect(second).toHaveValue("");
    await expect(page).toHaveURL(`${origins.admin}/invitations?${list}`);
    expect(
      submittedQueries.map((query) => [
        query.get("search"),
        query.get("eventId"),
        query.get("secondEventId"),
      ]),
    ).toEqual([[search, eventA, null]]);
    resumeRequest.resolve();
    await expectApplied({ mode: "exact", selected: [eventA], rows: [a] });
    page.off("request", recordSubmission);
    for (const control of await form.locator("input, select").all()) {
      await expect(control).toBeEnabled();
    }
    await expect(page.locator("#invitation-results-heading")).toBeFocused();

    const cancelledRequest = Promise.withResolvers<void>();
    const releaseCancelled = Promise.withResolvers<void>();
    const cancelledResponseFinished = Promise.withResolvers<void>();
    await page.route(
      (url) =>
        url.pathname === "/invitations" &&
        url.searchParams.get("eligibility") === "legacy",
      async (route) => {
        const response = await route.fetch();
        cancelledRequest.resolve();
        await releaseCancelled.promise;
        try {
          await route.fulfill({ response });
        } catch {
          // Back can abort the held browser request.
        } finally {
          cancelledResponseFinished.resolve();
        }
      },
      { times: 1 },
    );
    try {
      await match.selectOption("legacy");
      await apply.click();
      await cancelledRequest.promise;
      await expect(searchField).toBeDisabled();
      await page.goBack();
      await expectApplied({ mode: "", rows: [a, ab, abc, zero] });
    } finally {
      releaseCancelled.resolve();
    }
    await cancelledResponseFinished.promise;
    await expectApplied({ mode: "", rows: [a, ab, abc, zero] });
    await page.goForward();
    await expectApplied({ mode: "exact", selected: [eventA], rows: [a] });

    // Discard an unsent draft on history navigation and recover the applied controls.
    await match.selectOption("none");
    await page.getByLabel("Search invitations").fill("Unsaved filter");
    await page.goBack();
    await expectApplied({ mode: "", rows: [a, ab, abc, zero] });
    await page.goForward();
    await expectApplied({ mode: "exact", selected: [eventA], rows: [a] });
    await expect(page.getByLabel("Search invitations")).toHaveValue(search);
    const direct = page.url();
    await page.goto(direct.replace(/#.*$/, ""));
    await expectApplied({ mode: "exact", selected: [eventA], rows: [a] });
    await page.reload();
    await expectApplied({ mode: "exact", selected: [eventA], rows: [a] });

    await second.selectOption(eventB);
    const pairedRequests: URL[] = [];
    const recordPairedSubmission = (request: { url(): string }) => {
      const url = new URL(request.url());
      if (isExactNavigation(url)) pairedRequests.push(url);
    };
    page.on("request", recordPairedSubmission);
    await apply.evaluate((button: HTMLButtonElement) => {
      const filterForm = button.form!;
      filterForm.requestSubmit(button);
      filterForm.requestSubmit(button);
    });
    await expectApplied({
      mode: "exact",
      selected: [eventA, eventB],
      rows: [ab],
    });
    page.off("request", recordPairedSubmission);
    expect(pairedRequests).toHaveLength(1);
    await match.selectOption("legacy");
    await expect(second).toHaveCount(0);
    await apply.click();
    await expectApplied({ mode: "legacy", rows: [abc] });
    await match.selectOption("none");
    await apply.click();
    await expectApplied({ mode: "none", rows: [zero] });

    await match.selectOption("includes");
    await expect(first).toHaveValue("");
    await expect(second).toHaveValue("");
    await first.selectOption(eventA);
    await page.getByLabel("Invitation status").selectOption("ACTIVE");
    await page.getByLabel("RSVP status").selectOption("PENDING");
    await page.getByLabel("Opening activity").selectOption("unopened");
    await page.getByLabel("Sort direction").selectOption("desc");
    await page.getByLabel("Per page").fill("1");
    await apply.click();
    await expectApplied({
      mode: "includes",
      selected: [eventA],
      rows: [ab],
      total: 2,
    });
    await page.getByRole("link", { name: "Next", exact: true }).click();
    await expectApplied({
      mode: "includes",
      selected: [eventA],
      rows: [a],
      total: 2,
      pageNumber: "2",
    });
    await expect(page.getByLabel("Invitation status")).toHaveValue("ACTIVE");
    await expect(page.getByLabel("RSVP status")).toHaveValue("PENDING");
    await expect(page.getByLabel("Opening activity")).toHaveValue("unopened");
    await expect(page.getByLabel("Sort direction")).toHaveValue("desc");
    await expect(page.getByLabel("Per page")).toHaveValue("1");
    await page.getByRole("link", { name: "Reset all" }).click();
    await expect(page).toHaveURL(`${origins.admin}/invitations`);
    await expect(match).toHaveValue("");
    await expect(first).toHaveCount(0);
    await expect(page.getByLabel("Search invitations")).toHaveValue("");
    await match.selectOption("legacy");
    await page.getByLabel("Search invitations").fill("Reset this draft");
    await page.getByRole("link", { name: "Reset all" }).click();
    await expect(match).toHaveValue("");
    await expect(page.getByLabel("Search invitations")).toHaveValue("");
  } finally {
    resumeRequest.resolve();
    await fixture.prisma.invitationEvent.deleteMany({
      where: { eventId: { in: extraEvents } },
    });
    await fixture.prisma.event.deleteMany({
      where: { id: { in: extraEvents } },
    });
    await fixture.cleanup();
  }
});

test("WhatsApp handoff rechecks real rotation, archive and session expiry", async ({
  page,
  context,
}) => {
  const fixture = await createWorkflowFixture();
  try {
    const rotating = await fixture.household("Handoff rotation", {
      pending: true,
    });
    const archiving = await fixture.household("Handoff archive", {
      pending: true,
    });
    // Same-tab handoff must also work when popups are unavailable.
    await page.addInitScript(() => {
      window.open = () => {
        throw new Error("Popup unavailable");
      };
    });
    await signIn(page, fixture);
    await page.goto("/invitations");
    const row = (name: string) =>
      page.getByRole("row").filter({ hasText: name });
    const prepare = (name: string) =>
      row(name).getByRole("button", { name: "Prepare WhatsApp" });
    const handoff = (name: string) =>
      row(name).getByRole("button", { name: "Open WhatsApp" });
    const session = await (await page.request.get("/api/admin/auth/me")).json();
    const headers = {
      Origin: origins.admin,
      "X-CSRF-Token": session.csrfToken,
    };
    const lifecyclePath = (id: string, action: string) =>
      `/api/admin/invitations/${id}/${action}`;
    let validUrl = "";
    let handoffs = 0;
    await context.route("https://wa.me/**", async (route) => {
      handoffs += 1;
      expect(validUrl.length > 0).toBe(true);
      const message = new URL(route.request().url()).searchParams.get("text");
      expect(message?.endsWith(validUrl)).toBe(true);
      expect(route.request().headers().referer).toBeUndefined();
      await route.fulfill({ body: "Intercepted WhatsApp handoff" });
    });
    await prepare(archiving.name).click();
    await expect(handoff(archiving.name)).toBeVisible();
    const archived = await page.request.post(
      lifecyclePath(archiving.id, "archive"),
      {
        headers,
        data: {},
      },
    );
    expect(archived.status()).toBe(200);
    await handoff(archiving.name).click();
    await expect(row(archiving.name).getByRole("alert")).toContainText(
      "now archived",
    );
    await expect(handoff(archiving.name)).toHaveCount(0);
    expect(handoffs).toBe(0);

    await prepare(rotating.name).click();
    await expect(handoff(rotating.name)).toBeVisible();
    let credential = rotating.publicCredential;
    for (const version of [1, 2]) {
      const rotated = await page.request.post(
        lifecyclePath(rotating.id, "regenerate-token"),
        { headers, data: { expectedTokenVersion: version } },
      );
      expect(rotated.status()).toBe(200);
      validUrl = (await rotated.json()).publicUrl;
      const obsolete = await page.request.get(
        `${origins.api}/api/public/invitations/${credential}`,
      );
      expect(obsolete.status()).toBe(404);
      credential = new URL(validUrl).pathname.split("/").at(-1)!;
      await handoff(rotating.name).click();
      await expect(row(rotating.name).getByText(/Confirm again/)).toBeVisible();
      await expect(handoff(rotating.name)).toBeEnabled();
      expect(handoffs).toBe(0);
    }
    await handoff(rotating.name).click();
    await expect(page.getByText("Intercepted WhatsApp handoff")).toBeVisible();
    expect(handoffs).toBe(1);
    await page.goBack();
    await expect(handoff(rotating.name)).toHaveCount(0);
    await prepare(rotating.name).click();
    await expect(handoff(rotating.name)).toBeVisible();
    await fixture.prisma.adminSession.deleteMany({
      where: { adminUserId: fixture.owner.id },
    });
    await handoff(rotating.name).click();
    await expect(page).toHaveURL(/\/login\?session=ended$/);
    expect(handoffs).toBe(1);
  } finally {
    await fixture.cleanup();
  }
});

test("streamed invitation detail reaches the current fragment without remounting editors", async ({
  page,
}) => {
  const fixture = await createWorkflowFixture();
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    const household = await fixture.household("Detail fragment fixture", {
      pending: true,
    });
    await fixture.prisma.invitationEvent.deleteMany({
      where: { invitationId: household.id },
    });
    await signIn(page, fixture);
    const path = `/invitations/${household.id}`;
    const eligibility = page.getByRole("heading", { name: "Eligible events" });
    const sharing = page.getByRole("heading", { name: "Sharing", exact: true });
    async function expectReached(heading: typeof eligibility) {
      await expect(heading).toBeFocused();
      await expect(heading).toBeInViewport();
      expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(70);
    }
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/invitations");
      if (width === 375) {
        await page.route(
          (url) => url.pathname === path,
          async (route) => {
            const response = await route.fetch();
            requested.resolve();
            await release.promise;
            await route.fulfill({ response });
          },
          { times: 1 },
        );
      }
      await page.getByRole("link", { name: "Review eligibility" }).click();
      if (width === 375) {
        await requested.promise;
        await expect(eligibility).toHaveCount(0);
        release.resolve();
      }
      await expect(page).toHaveURL(
        `${origins.admin}${path}#eligible-events-title`,
      );
      await expectReached(eligibility);
      await page.goBack();
      await page
        .getByRole("link", { name: "Personal message", exact: true })
        .click();
      await expect(page).toHaveURL(`${origins.admin}${path}#sharing`);
      await expectReached(sharing);
    }
    await page.goBack();
    await page.goForward();
    await expectReached(sharing);
    await page.reload();
    await expectReached(sharing);

    await page.goto(path + "?direct=1#eligible-events-title");
    await expectReached(eligibility);
    const sections = page.getByRole("navigation", {
      name: "Invitation detail sections",
    });
    await sections.getByRole("link", { name: "Activity and RSVP" }).click();
    await expect(page.locator("#invitation-activity")).toBeFocused();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const draft = page.getByLabel("Full name (required)");
    await draft.fill("Unsaved guest name");
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue("Unsaved guest name");

    await page.goto(path + "?direct=2#unrecognized-section");
    await expect(
      page.getByRole("heading", { name: "Invitation detail" }),
    ).toBeInViewport();
    await expect(eligibility).not.toBeFocused();
    await expect(sharing).not.toBeFocused();
  } finally {
    release.resolve();
    await fixture.cleanup();
  }
});
