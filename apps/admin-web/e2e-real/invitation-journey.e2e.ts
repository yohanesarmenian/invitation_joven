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
  await page
    .getByRole("button", { name: "View invitation", exact: true })
    .click();
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
  await page.getByRole("button", { name: "Send RSVP", exact: true }).click();
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
        canvas.getContext("2d")!.drawImage(image, 0, 0, 320, 320);
        URL.revokeObjectURL(url);
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
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

    // Accepted edits keep the active pass; decline revokes it; reaccept issues a new pass.
    await guest
      .getByLabel("Dietary requirements (optional)")
      .fill("Updated synthetic note");
    await guest.getByRole("button", { name: "Send RSVP", exact: true }).click();
    await expect
      .poll(async () => (await readRsvp()).dietaryNotes)
      .toBe("Updated synthetic note");
    expect(
      (await guest.locator(".checkin-code").innerText()).trim() === firstCode,
    ).toBe(true);
    await guest.getByRole("radio", { name: "Regretfully Decline" }).check();
    await guest.getByRole("button", { name: "Send RSVP", exact: true }).click();
    await expect(guest.locator(".checkin-code")).toHaveCount(0);
    expect(
      await fixture.prisma.checkinPass.count({
        where: { invitationId: household.id, status: "ACTIVE" },
      }),
    ).toBe(0);
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
    for (const invalid of [household.publicCredential, firstCode]) {
      await page.getByLabel("QR code", { exact: true }).fill(invalid);
      await page
        .getByRole("button", { name: "Validate QR", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Confirm check-in", exact: true }),
      ).toHaveCount(0);
      await expect(page.getByRole("alert")).toBeVisible();
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

test("opening waits for a delayed photo and reduced motion completes pending preparation", async ({
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
    if (
      new URL(route.request().url()).searchParams
        .get("url")
        ?.startsWith("/assets/photography/cover-")
    )
      await held;
    await route.continue();
  });
  try {
    await page.goto(`${publicOrigin}/i/${household.publicCredential}`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("button", { name: "Open invitation", exact: true })
      .click();
    await expect(page.getByText("Preparing your invitation…")).toBeVisible();
    await page.getByRole("button", { name: "Enable animations" }).click();
    await expect(
      page.getByRole("button", { name: "View invitation" }),
    ).toBeFocused();
    release();
    await page.getByRole("button", { name: "View invitation" }).click();
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
      ".invitation-envelope-layer { transition: none !important; } .invitation-cover-stack, .invitation-opening-content { animation: none !important; }",
  });
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  // Cross-tab notification must not cancel the active fallback deadline.
  await page.evaluate(() => {
    localStorage.setItem("jo-venta-motion", "full");
    dispatchEvent(
      new StorageEvent("storage", { key: "jo-venta-motion", newValue: "full" }),
    );
  });
  await expect(
    page.getByRole("button", { name: "View invitation" }),
  ).toBeFocused();
  // Inject at the reveal boundary, after framework hydration has completed.
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
  await page.getByRole("button", { name: "View invitation" }).press("Enter");
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
      await expect(
        page.getByRole("button", { name: "View invitation" }),
      ).toBeFocused();
      if (mode === "failed")
        await expect(page.locator("#invitation-opened-title")).toBeVisible();
      await page.getByRole("button", { name: "View invitation" }).click();
      await expect(page.getByRole("form", { name: "Your RSVP" })).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  }
});
