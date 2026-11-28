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
    .getByRole("button", { name: "Buka Undangan", exact: true })
    .click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
}
async function accept(page: Page) {
  await page.getByRole("radio", { name: "Dengan senang hati hadir" }).check();
  await page
    .getByRole("radio", { name: "Saya hadir bersama keluarga", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Sertakan satu pendamping tambahan" })
    .check();
  await page
    .getByRole("checkbox", { name: "Sertakan anak", exact: true })
    .check();
  await page.getByRole("spinbutton", { name: /anak tambahan/i }).fill("1");
  await page
    .getByLabel("Kebutuhan dan preferensi makanan (opsional)")
    .fill("Synthetic no seafood");
  await page
    .getByRole("button", {
      name: /^(Kirim RSVP|Simpan Perubahan)$/,
      exact: true,
    })
    .click();
  await expect(
    page.getByText(
      "Silakan tunjukkan undangan ini kepada penerima tamu saat tiba di lokasi acara.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator(".guest-checkin-pass, .checkin-code")).toHaveCount(
    0,
  );
}
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
      guest.getByRole("heading", {
        name: "Kehadiran Terkonfirmasi",
        exact: true,
      }),
    ).toBeVisible();
    await expect(guest.getByRole("form", { name: "RSVP Anda" })).toHaveCount(0);
    await expect(
      guest.getByText(
        "Silakan tunjukkan undangan ini kepada penerima tamu saat tiba di lokasi acara.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      guest.locator(".guest-checkin-pass, .checkin-code"),
    ).toHaveCount(0);
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

test("same-name households keep distinct personal links, greetings and RSVPs without passes", async ({
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
  try {
    const firstGuest = await guestContext.newPage();
    await open(firstGuest, first.publicCredential);
    await expect(firstGuest.locator("#invitation-title")).toHaveText(
      greetings[0]!,
    );
    await expect(firstGuest.locator(".checkin-code")).toHaveCount(0);
    await accept(firstGuest);
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
    expect(
      await fixture.prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: first.id },
      }),
    ).toEqual(firstRsvp);
    await open(firstGuest, first.publicCredential);
    await expect(
      firstGuest.getByText(
        "Silakan tunjukkan undangan ini kepada penerima tamu saat tiba di lokasi acara.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      firstGuest.locator(".guest-checkin-pass, .checkin-code"),
    ).toHaveCount(0);
    expect(
      await fixture.prisma.checkinPass.count({
        where: {
          invitationId: { in: households.map((household) => household.id) },
        },
      }),
    ).toBe(0);
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
      name: "Buka Undangan",
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
    name: "Buka Undangan",
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
        .getByRole("button", { name: "Buka Undangan", exact: true })
        .click();
      await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
        "data-stage",
        "content",
      );
      await expect(page.locator(".invitation-opening-content")).toBeFocused();
      if (mode === "failed")
        await expect(page.locator(".invitation-hero")).toBeVisible();
      await expect(page.getByRole("form", { name: "RSVP Anda" })).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  }
});
