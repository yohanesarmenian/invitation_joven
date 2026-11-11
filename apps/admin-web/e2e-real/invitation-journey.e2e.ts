import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";

const origins = runnerOrigins();
const publicOrigin = origins.invitation;
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
test.beforeAll(async () => {
  fixture = await createWorkflowFixture();
});
test.afterAll(async () => {
  await fixture?.cleanup();
});

async function open(page: Page, credential: string) {
  await page.goto(`${publicOrigin}/i/${credential}`);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
}
async function accept(page: Page) {
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await page
    .getByRole("checkbox", { name: "Synthetic Guest", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: /Wife\/Husband or plus one/ })
    .check();
  await page.getByRole("checkbox", { name: /with my children/ }).check();
  await page
    .getByRole("checkbox", { name: fixture.event.name, exact: true })
    .check();
  await page.getByLabel(`Guests attending ${fixture.event.name}`).fill("3");
  await page
    .getByLabel("Dietary requirements (optional)")
    .fill("Synthetic no seafood");
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/, exact: true })
    .click();
  await expect(page.locator(".checkin-code")).toBeVisible();
}
async function staffLogin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.staff.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL("/checkin", origins.admin).href);
  await page
    .getByLabel("Event", { exact: true })
    .selectOption(fixture.event.id);
}
async function installCamera(page: Page, svg: string) {
  // Real guest-rendered SVG becomes a raster video stream. ZXing itself is unmodified.
  await page.addInitScript((source: string) => {
    Reflect.set(window, "journeyStoppedTracks", 0);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 320;
        const image = new Image();
        const url = URL.createObjectURL(
          new Blob([source], { type: "image/svg+xml" }),
        );
        image.src = url;
        await image.decode();
        const stream = canvas.captureStream(15);
        const context = canvas.getContext("2d")!;
        let paintFrame = 0;
        // captureStream's frame rate is a ceiling. Fresh frames require repainting.
        function paint() {
          context.drawImage(image, 0, 0, 320, 320);
          paintFrame = requestAnimationFrame(paint);
        }
        paint();
        URL.revokeObjectURL(url);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            cancelAnimationFrame(paintFrame);
            Reflect.set(
              window,
              "journeyStoppedTracks",
              Reflect.get(window, "journeyStoppedTracks") + 1,
            );
            stop();
          };
        }
        return stream;
      },
    });
  }, svg);
}

test("synthetic camera delivers advancing frames and releases its tracks", async ({
  page,
}) => {
  await installCamera(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" fill="white"/><rect x="80" y="80" width="160" height="160" fill="black"/></svg>',
  );
  await page.goto("/login");
  await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const probe = {
      times: [] as number[],
      playError: null as string | null,
      stop: () => {
        stream.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
        video.remove();
        return stream
          .getTracks()
          .every((track) => track.readyState === "ended");
      },
    };
    function recordFrame(_now: number, metadata: VideoFrameCallbackMetadata) {
      probe.times.push(metadata.mediaTime);
      if (stream.active) video.requestVideoFrameCallback(recordFrame);
    }
    video.requestVideoFrameCallback(recordFrame);
    video.srcObject = stream;
    document.body.append(video);
    Reflect.set(window, "journeyFrameProbe", probe);
    void video.play().catch((error: Error) => {
      probe.playError = error.name;
    });
  });
  try {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const probe = Reflect.get(window, "journeyFrameProbe");
          return {
            advancing:
              probe.times.length >= 2 && probe.times[1] > probe.times[0],
            playError: probe.playError,
          };
        }),
      )
      .toEqual({ advancing: true, playError: null });
  } finally {
    expect(
      await page.evaluate(() =>
        Reflect.get(window, "journeyFrameProbe").stop(),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => Reflect.get(window, "journeyStoppedTracks")),
    ).toBeGreaterThan(0);
  }
});

test("guest RSVP and message issue a real pass; staff camera decodes, recovers a lost confirmation and rejects a duplicate", async ({
  page,
  browser,
}) => {
  const household = await fixture.household("Journey Household", {
    pending: true,
    plusOne: true,
    children: 1,
  });
  expect(
    await fixture.prisma.checkinPass.count({
      where: { invitationId: household.id },
    }),
  ).toBe(0);
  expect(
    await fixture.prisma.rSVP.count({ where: { invitationId: household.id } }),
  ).toBe(0);
  const guestContext = await browser.newContext({ reducedMotion: "reduce" });
  const guest = await guestContext.newPage();
  try {
    await open(guest, household.publicCredential);
    await expect(guest.locator(".checkin-code")).toHaveCount(0);
    await accept(guest);
    const firstCode = (await guest.locator(".checkin-code").innerText()).trim();
    expect(
      firstCode !== household.publicCredential && /^[\w-]{43}$/.test(firstCode),
    ).toBe(true);
    const readRsvp = () =>
      fixture.prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: household.id },
        include: { attendees: true, eventSelections: true },
      });
    const accepted = await readRsvp();
    expect(accepted.status).toBe("ACCEPTED");
    expect(
      accepted.attendees.reduce((sum, item) => sum + item.quantity, 0),
    ).toBe(3);
    expect(
      accepted.attendees.filter((item) => item.attendeeType === "PLUS_ONE"),
    ).toHaveLength(1);
    expect(accepted.eventSelections[0]?.expectedAttendeeCount).toBe(3);
    expect(accepted.dietaryNotes).toBe("Synthetic no seafood");

    await guest.getByRole("button", { name: "Edit RSVP", exact: true }).click();
    // Accepted edits keep the active pass; decline revokes it; reaccept issues a new pass.
    await guest
      .getByLabel("Dietary requirements (optional)")
      .fill("Updated synthetic note");
    await guest
      .getByRole("button", {
        name: /^(Submit RSVP|Save Changes)$/,
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await readRsvp()).dietaryNotes)
      .toBe("Updated synthetic note");
    expect(
      (await guest.locator(".checkin-code").innerText()).trim() === firstCode,
    ).toBe(true);
    await guest.getByRole("button", { name: "Edit RSVP", exact: true }).click();
    await guest.getByRole("radio", { name: "Regretfully Decline" }).check();
    await guest
      .getByRole("button", {
        name: /^(Submit RSVP|Save Changes)$/,
        exact: true,
      })
      .click();
    await expect(guest.locator(".checkin-code")).toHaveCount(0);
    expect(
      await fixture.prisma.checkinPass.count({
        where: { invitationId: household.id, status: "ACTIVE" },
      }),
    ).toBe(0);
    await guest.getByRole("button", { name: "Edit RSVP", exact: true }).click();
    await accept(guest);
    const qr = (await guest.locator(".checkin-code").innerText()).trim();
    expect(qr !== firstCode).toBe(true);
    for (const width of [320, 360, 412, 768, 1440]) {
      await guest.setViewportSize({ width, height: 900 });
      const box = await guest
        .getByRole("img", { name: "Household check-in pass QR code" })
        .boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(200);
      expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
      expect(box!.x >= 0 && box!.x + box!.width <= width).toBe(true);
    }
    let svg = await guest
      .getByRole("img", { name: "Household check-in pass QR code" })
      .evaluate((node) => node.outerHTML);
    if (!svg.includes("xmlns="))
      svg = svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
    const message =
      "Synthetic congratulations <script>window.journeyXss=1</script>";
    await guest.getByLabel(/Your name/).fill("Synthetic Journey Guest");
    await guest.getByLabel(/Your message/).fill(message);
    await guest.getByRole("button", { name: /^Send Message$/ }).click();
    await expect
      .poll(() =>
        fixture.prisma.guestMessage.count({
          where: { invitationId: household.id },
        }),
      )
      .toBe(1);
    const stored = await fixture.prisma.guestMessage.findFirstOrThrow({
      where: { invitationId: household.id },
    });
    expect(
      stored.message === message &&
        stored.authorName === "Synthetic Journey Guest",
    ).toBe(true);
    expect(
      await guest.evaluate(
        () => Reflect.get(window, "journeyXss") === undefined,
      ),
    ).toBe(true);

    await installCamera(page, svg);
    await staffLogin(page);
    // Keep an unrelated live alert present: Next's route announcer must never
    // satisfy (or make ambiguous) an assertion about the check-in result.
    await page.evaluate(() => {
      const announcer = document.createElement("div");
      announcer.setAttribute("role", "alert");
      announcer.textContent = "Journey navigation announcement";
      document.body.append(announcer);
    });
    for (const [invalid, code, message] of [
      [
        household.publicCredential,
        "QR_INVALID",
        "This QR is invalid or no longer available. Check the code or search the household.",
      ],
      [
        firstCode,
        "QR_REVOKED",
        "This QR has been revoked. Ask the guest for their current pass.",
      ],
    ] as const) {
      await page.getByLabel("QR code", { exact: true }).fill(invalid);
      const rejected = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/admin/checkin/validate" &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Validate QR", exact: true })
        .click();
      const response = await rejected;
      expect(response.status()).toBe(422);
      expect((await response.json()).error.code).toBe(code);
      await expect(
        page.getByRole("button", { name: "Confirm check-in", exact: true }),
      ).toHaveCount(0);
      const alert = page
        .getByRole("region", { name: "Check-in result", exact: true })
        .getByRole("alert");
      await expect(alert).toBeVisible();
      await expect(alert).toHaveText(message);
    }
    let validations = 0,
      writes = 0;
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/checkin/validate")) validations++;
      if (pathname.endsWith("/checkin/confirm")) writes++;
    });
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: household.name, exact: true }),
    ).toBeVisible();
    expect(validations).toBe(1);
    expect(writes).toBe(0);
    expect(
      await fixture.prisma.checkinRecord.count({
        where: { invitationId: household.id },
      }),
    ).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(() => Reflect.get(window, "journeyStoppedTracks")),
      )
      .toBeGreaterThan(0);
    await expect(page.locator("video")).toHaveCount(0);
    // Only two of the three expected attendees arrive. Actual must remain distinct.
    await page.getByLabel("People arriving now").fill("2");
    await page.route("**/api/admin/checkin/confirm", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page
      .getByRole("button", { name: "Confirm check-in", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Check the server before continuing" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Recheck exact household and event",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Already confirmed", exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    const records = await fixture.prisma.checkinRecord.findMany({
      where: { invitationId: household.id },
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventId: fixture.event.id,
      attendeeCount: 2,
      method: "QR",
      confirmedByAdminUserId: fixture.staff.id,
    });
    expect(records[0]!.checkedInAt instanceof Date).toBe(true);
    await page.reload();
    await page
      .getByLabel("Event", { exact: true })
      .selectOption(fixture.event.id);
    await page
      .getByRole("button", { name: "Start camera", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Already confirmed", exact: true }),
    ).toBeVisible();
    expect(
      await fixture.prisma.checkinRecord.count({
        where: { invitationId: household.id },
      }),
    ).toBe(1);
    for (const path of [
      "dashboard",
      "invitations",
      "rsvps",
      "messages",
      "reports/summary",
      "staff",
    ]) {
      expect((await page.request.get(`/api/admin/${path}`)).status()).toBe(403);
    }
  } finally {
    await guestContext.close();
  }
});

test("OWNER create form persists one invitation and its WIB deadline, then the mobile guest RSVP survives reload", async ({
  page,
  browser,
}) => {
  const name = `Phase4A synthetic household ${fixture.owner.id}`;
  const guestContext = await browser.newContext({
    viewport: { width: 375, height: 900 },
  });
  try {
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new URL("/", origins.admin).href);
    const catalogResponse = await page.request
      .get("/api/admin/events")
      .catch(() => null);
    const catalog = await catalogResponse?.json().catch(() => null);
    const events: unknown[] | null = Array.isArray(catalog?.events)
      ? catalog.events
      : null;
    const eventState = {
      catalogStatus: catalogResponse?.status() ?? null,
      totalEvents: events?.length ?? null,
      activeEvents:
        events?.filter(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "isActive" in event &&
            event.isActive === true,
        ).length ?? null,
      fixtureEventOnly:
        events?.length === 1 &&
        typeof events[0] === "object" &&
        events[0] !== null &&
        "id" in events[0] &&
        events[0].id === fixture.event.id,
    };
    const routeResponse = await page.goto("/invitations/new");
    try {
      await expect(
        page.locator("#invitee-0"),
        JSON.stringify(eventState),
      ).toBeVisible();
      expect(eventState).toEqual({
        catalogStatus: 200,
        totalEvents: 1,
        activeEvents: 1,
        fixtureEventOnly: true,
      });
    } finally {
      const location = new URL(page.url());
      const path = location.pathname;
      console.info(
        JSON.stringify({
          diagnostic: "OWNER_CREATE_READINESS",
          url:
            location.origin === origins.admin &&
            ["/invitations/new", "/login", "/account/password", "/"].includes(
              path,
            )
              ? new URL(path, origins.admin).href
              : "OTHER_ROUTE",
          routeStatus: routeResponse?.status() ?? null,
          createHeading: await page
            .getByRole("heading", { name: "Create invitation", exact: true })
            .isVisible(),
          eventUnavailable: await page
            .getByRole("heading", {
              name: "Wedding event unavailable",
              exact: true,
            })
            .isVisible(),
          readUnavailable: await page
            .getByRole("heading", {
              name: /^(Unable to load invitations|Invitation access unavailable)$/,
            })
            .isVisible(),
          loading: await page
            .getByText("Loading wedding event…", { exact: true })
            .isVisible(),
          formPresent: await page.locator("#invitee-0").isVisible(),
          ...eventState,
        }),
      );
    }
    await page.locator("#invitee-0").fill("Synthetic Guest");
    await page.getByText("Household name (optional)", { exact: true }).click();
    await page.getByLabel("Invitation / household name (optional)").fill(name);
    await page
      .getByText("Greeting, additional guests, children and RSVP deadline", {
        exact: true,
      })
      .click();
    await page.getByLabel("Allow one plus-one guest").check();
    await page
      .getByLabel("Maximum additional children", { exact: true })
      .fill("1");
    await page
      .getByLabel("Deadline date (WIB)", { exact: true })
      .fill("2027-12-01");
    await page.getByLabel("Deadline time (WIB)", { exact: true }).fill("00:30");
    const response = page.waitForResponse(
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
    expect((await response).status()).toBe(201);
    await expect(
      page.getByRole("heading", { name: "Invitation created", exact: true }),
    ).toBeVisible();
    const invitations = await fixture.prisma.invitation.findMany({
      where: { displayName: name },
    });
    expect(invitations).toHaveLength(1);
    const invitation = invitations[0]!;
    expect(invitation.rsvpDeadlineAt?.toISOString()).toBe(
      "2027-11-30T17:30:00.000Z",
    );
    expect(
      await fixture.prisma.rSVP.count({
        where: { invitationId: invitation.id },
      }),
    ).toBe(0);
    const url = await page.getByLabel("Public invitation link").inputValue();
    expect(new URL(url).origin === publicOrigin).toBe(true);
    const guest = await guestContext.newPage();
    await open(guest, new URL(url).pathname.split("/").at(-1)!);
    await accept(guest);
    const saved = await fixture.prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: invitation.id },
    });
    expect(saved.status).toBe("ACCEPTED");
    expect(saved.dietaryNotes).toBe("Synthetic no seafood");
    await open(guest, new URL(url).pathname.split("/").at(-1)!);
    await expect(
      guest.getByRole("heading", { name: "Attendance Confirmed", exact: true }),
    ).toBeVisible();
    await expect(guest.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
    await expect(guest.locator(".checkin-code")).toBeVisible();
    expect(
      await fixture.prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: invitation.id },
      }),
    ).toEqual(saved);
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto(`/rsvps/${saved.id}`);
    const history = page.getByRole("region", {
      name: "RSVP Change History",
      exact: true,
    });
    await expect(
      history.getByRole("heading", {
        name: "Initial RSVP submission",
        exact: true,
      }),
    ).toBeVisible();
    await expect(history).toContainText("Guest-link holder");
    await expect(history).toContainText("WIB");
    await expect(history).toContainText("Synthetic no seafood");
    await expect(guest.locator("body")).not.toContainText(
      "RSVP Change History",
    );
  } finally {
    await guestContext.close();
    const ids = (
      await fixture.prisma.invitation.findMany({
        where: { displayName: name },
        select: { id: true },
      })
    ).map((item) => item.id);
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
  }
});

test("same-name households keep distinct personal links, greetings, RSVP and guest-issued QR passes", async ({
  page,
  browser,
}) => {
  const first = await fixture.household("Synthetic Same Name Household", {
    pending: true,
    plusOne: true,
    children: 1,
  });
  const second = await fixture.household("Synthetic Same Name Household", {
    pending: true,
    plusOne: true,
    children: 1,
  });
  const households = [first, second];
  const greetings = ["Synthetic First Greeting", "Synthetic Second Greeting"];
  for (const [index, household] of households.entries()) {
    await fixture.prisma.invitation.update({
      where: { id: household.id },
      data: { greetingName: greetings[index] },
    });
  }
  // Compare bearer values as booleans so assertion diagnostics do not print them.
  expect(first.publicCredential !== second.publicCredential).toBe(true);
  const guestContext = await browser.newContext({ reducedMotion: "reduce" });
  const codes: string[] = [];
  try {
    const firstGuest = await guestContext.newPage();
    await open(firstGuest, first.publicCredential);
    await expect(firstGuest.locator("#invitation-title")).toHaveText(
      greetings[0]!,
    );
    await expect(firstGuest.locator(".checkin-code")).toHaveCount(0);
    await accept(firstGuest);
    codes.push((await firstGuest.locator(".checkin-code").innerText()).trim());
    const firstRsvp = await fixture.prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: first.id },
    });
    expect(
      await fixture.prisma.rSVP.count({ where: { invitationId: second.id } }),
    ).toBe(0);
    expect(
      await fixture.prisma.checkinPass.count({
        where: { invitationId: second.id },
      }),
    ).toBe(0);

    const secondGuest = await guestContext.newPage();
    await open(secondGuest, second.publicCredential);
    await expect(secondGuest.locator("#invitation-title")).toHaveText(
      greetings[1]!,
    );
    await expect(secondGuest.locator(".checkin-code")).toHaveCount(0);
    await accept(secondGuest);
    codes.push((await secondGuest.locator(".checkin-code").innerText()).trim());
    expect(codes[0] !== codes[1]).toBe(true);
    expect(
      codes.every(
        (code) =>
          /^[\w-]{43}$/.test(code) &&
          households.every((household) => code !== household.publicCredential),
      ),
    ).toBe(true);
    expect(
      await fixture.prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: first.id },
      }),
    ).toEqual(firstRsvp);
    await open(firstGuest, first.publicCredential);
    await expect(firstGuest.locator(".checkin-code")).toBeVisible();
    expect(
      (await firstGuest.locator(".checkin-code").innerText()).trim() ===
        codes[0],
    ).toBe(true);

    await staffLogin(page);
    const session = await (await page.request.get("/api/admin/auth/me")).json();
    for (const [index, household] of households.entries()) {
      const response = await page.request.post("/api/admin/checkin/validate", {
        headers: {
          Origin: new URL(page.url()).origin,
          "X-CSRF-Token": session.csrfToken,
        },
        data: { eventId: fixture.event.id, qrPayload: codes[index] },
      });
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.status).toBe("VALID");
      expect(result.invitation.id === household.id).toBe(true);
    }
    expect(
      await fixture.prisma.checkinRecord.count({
        where: {
          invitationId: { in: households.map((household) => household.id) },
        },
      }),
    ).toBe(0);
  } finally {
    await guestContext.close();
  }
});

test("delayed hero readiness follows system reduced motion without bypassing preparation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const household = await fixture.household("Journey Motion", {
    pending: true,
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/image?**", async (route) => {
    const asset = new URL(route.request().url()).searchParams.get("url") ?? "";
    if (
      asset.startsWith("/assets/photography/cover-") ||
      asset === "/assets/hero/opened-hero.png"
    )
      await held;
    await route.continue();
  });
  try {
    await page.goto(`${publicOrigin}/i/${household.publicCredential}`, {
      waitUntil: "domcontentloaded",
    });
    const openButton = page.getByRole("button", {
      name: "Open invitation",
      exact: true,
    });
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-motion",
      "full",
    );
    await expect(openButton).toBeDisabled();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-motion",
      "reduced",
    );
    await expect(openButton).toBeDisabled();
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-stage",
      "closed",
    );
    release();
    await expect(openButton).toBeEnabled();
    await openButton.click();
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-stage",
      "content",
    );
    await expect(page.locator(".invitation-opening-content")).toBeFocused();
    await page.reload();
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-motion",
      "reduced",
    );
  } finally {
    release();
  }
});

test("disabled CSS end events and failed observers still leave readable, keyboard reachable content", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const household = await fixture.household("Journey Motion Fallback", {
    pending: true,
  });
  await page.goto(`${publicOrigin}/i/${household.publicCredential}`);
  await page.addStyleTag({
    content:
      ".invitation-envelope-layer { transition: none !important; } .invitation-opening-content { animation: none !important; }",
  });
  const openButton = page.getByRole("button", {
    name: "Open invitation",
    exact: true,
  });
  await expect(openButton).toBeEnabled();
  // Install before the single activation, after framework hydration has completed.
  await page.evaluate(() => {
    Object.defineProperty(window, "IntersectionObserver", {
      value: class {
        constructor() {
          throw Error("Synthetic observer failure");
        }
      },
      configurable: true,
    });
  });
  await openButton.press("Enter");
  // A legacy preference must not override the system or cancel the deadline.
  await page.evaluate(() => {
    localStorage.setItem("jo-venta-motion", "full");
    dispatchEvent(
      new StorageEvent("storage", { key: "jo-venta-motion", newValue: "full" }),
    );
  });
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  expect(
    await page
      .locator("[data-invitation-reveal]")
      .evaluateAll((nodes) =>
        nodes.every(
          (node) =>
            getComputedStyle(node).opacity === "1" ||
            node.classList.contains("invitation-revealed"),
        ),
      ),
  ).toBe(true);
  expect(
    (
      await fixture.prisma.invitation.findUniqueOrThrow({
        where: { id: household.id },
      })
    ).openCount,
  ).toBe(1);
});

test("never-loading and completely failed cover images cannot trap the guest", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const household = await fixture.household("Journey Broken Images", {
    pending: true,
  });
  for (const mode of ["never-loading", "failed"] as const) {
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route("**/_next/image?**", async (route) => {
      const asset =
        new URL(route.request().url()).searchParams.get("url") ?? "";
      if (
        asset.startsWith("/assets/photography/cover-") ||
        asset === "/assets/hero/opened-hero.png"
      ) {
        if (mode === "never-loading") await held;
        await route.abort();
      } else await route.continue();
    });
    try {
      await page.goto(`${publicOrigin}/i/${household.publicCredential}`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("button", { name: "Open invitation", exact: true })
        .click();
      await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
        "data-stage",
        "content",
      );
      await expect(page.locator(".invitation-opening-content")).toBeFocused();
      if (mode === "failed")
        await expect(page.locator(".invitation-hero")).toBeVisible();
      await expect(page.getByRole("form", { name: "Your RSVP" })).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  }
});
