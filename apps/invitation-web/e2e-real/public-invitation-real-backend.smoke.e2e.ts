import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  readSmokeState,
  runFixtureCli,
  type SmokeFixtureRead,
  type SmokeMessageState,
  type SmokePassState,
} from "./smoke-fixture";

// Internal fields that must never reach the browser. `publicTokenHash` and
// `tokenHash` in particular would let the raw credential be recovered by brute
// force offline, and `credentialVersion` is explicitly non-public per the
// "Public IDs" section of docs/API-CONTRACT.md.
const LEAKED_INTERNAL_FIELDS = [
  "publicTokenHash",
  "publicTokenVersion",
  "tokenHash",
  "credentialVersion",
  "firstOpenedAt",
  "lastOpenedAt",
  "openCount",
  "open_count",
];

// The compiled Nest API started by `playwright.real.config.ts`. Reached
// directly so the browser-rendered pass can be compared against the real
// canonical response without going through the Next server.
const REAL_API_BASE_URL = "http://127.0.0.1:4000";

const PASS_REGION = "Your check-in pass";
const QR_NAME = "Household check-in pass QR code";
const SMOKE_INVITEE = "5C Smoke Invitee";
const SMOKE_EVENT = "5C Smoke Ceremony";

/**
 * Compares two secret values without ever placing them in an assertion
 * message. `expect(a).toBe(b)` would print both on failure; this prints only
 * `false`.
 */
function sameSecret(a: string, b: string): boolean {
  return a === b;
}

type CanonicalRsvp = {
  checkinPass: {
    issuedAt: string;
    qrPayload: string;
    status: string;
  } | null;
  rsvp: { status: string; version: number } | null;
};

async function fetchCanonicalRsvp(
  publicCredential: string,
): Promise<CanonicalRsvp> {
  const response = await fetch(
    `${REAL_API_BASE_URL}/api/public/invitations/${publicCredential}/rsvp`,
  );

  expect(response.status).toBe(200);

  return (await response.json()) as CanonicalRsvp;
}

async function openInvitation(page: Page, publicCredential: string) {
  await page.goto(`/i/${publicCredential}`);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  await expect(page.locator(".public-rsvp-form")).toBeVisible();
}

async function editSaved(page: Page) {
  await page.getByRole("button", { name: "Edit RSVP", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save Changes", exact: true }),
  ).toBeVisible();
}
async function acceptInBrowser(page: Page) {
  if (
    await page.getByRole("button", { name: "Edit RSVP", exact: true }).count()
  )
    await editSaved(page);
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await page
    .getByRole("checkbox", { name: SMOKE_INVITEE, exact: true })
    .check();
  await page.getByRole("checkbox", { name: SMOKE_EVENT, exact: true }).check();
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
}

function passRegion(page: Page) {
  return page.getByRole("region", { name: PASS_REGION });
}

function passCode(page: Page) {
  return page.locator(".checkin-code");
}

async function expectPassVisible(page: Page): Promise<string> {
  const region = passRegion(page);

  await expect(region).toHaveCount(1);
  await expect(
    region.getByRole("heading", { name: PASS_REGION }),
  ).toBeVisible();
  await expect(region.getByRole("img", { name: QR_NAME })).toBeVisible();
  await expect(passCode(page)).toBeVisible();

  const payload = (await passCode(page).innerText()).trim();

  expect(payload).toMatch(/^[A-Za-z0-9_-]{43}$/);

  return payload;
}

async function expectPassAbsent(page: Page, stalePayload: string | null) {
  await expect(passRegion(page)).toHaveCount(0);
  await expect(passCode(page)).toHaveCount(0);

  if (stalePayload !== null) {
    const html = await page.content();

    expect(html.includes(stalePayload)).toBe(false);
  }
}

function passState(): SmokePassState {
  return runFixtureCli<SmokePassState>("pass-state");
}

function resetRsvp(): void {
  runFixtureCli<{ status: string }>("reset-rsvp");
}

/**
 * Asserts the public response and the rendered DOM carry none of the private
 * pass fields. Exact fixture values are used for the internal identifiers
 * rather than a broad "no id anywhere" string test, because the public
 * contract intentionally exposes `events[].id` and `invitees[].id`.
 */
async function expectNoPrivatePassFields(
  page: Page,
  state: ReturnType<typeof readSmokeState>,
  activePassIds: readonly string[],
) {
  const html = await page.content();

  for (const field of LEAKED_INTERNAL_FIELDS) {
    expect(html).not.toContain(field);
  }

  expect(html).not.toContain(state.invitationId);

  for (const passId of activePassIds) {
    expect(html.includes(passId)).toBe(false);
  }
}

async function expectNoBrowserPersistence(
  page: Page,
  payload: string,
): Promise<void> {
  const stored = await page.evaluate(() => ({
    cookie: document.cookie,
    localStorage: JSON.stringify(window.localStorage),
    sessionStorage: JSON.stringify(window.sessionStorage),
  }));

  expect(stored.localStorage.includes(payload)).toBe(false);
  expect(stored.sessionStorage.includes(payload)).toBe(false);
  expect(stored.cookie.includes(payload)).toBe(false);
}

test("real backend: one retrieval per server render, client stages stay local", async ({
  page,
}) => {
  const state = readSmokeState();
  const expectedOpenCount = state.beforeOpenCount + 1;

  await page.goto(`/i/${state.publicCredential}`);

  // Closed state: the invitation was retrieved server-side exactly once for
  // this render, which is what bumps open_count.
  const openButton = page.getByRole("button", { name: "Open invitation" });
  await expect(openButton).toBeVisible();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "closed",
  );
  await expect(page.getByRole("heading", { name: "Smoke Guest" })).toBeHidden();

  const afterRender = runFixtureCli<SmokeFixtureRead>("read");
  expect(afterRender.openCount).toBe(expectedOpenCount);
  expect(afterRender.firstOpenedAtPresent).toBe(true);
  expect(afterRender.lastOpenedAtPresent).toBe(true);

  await openButton.click();

  // The single activation starts a local transition without a new server render.
  expect(runFixtureCli<SmokeFixtureRead>("read").openCount).toBe(
    expectedOpenCount,
  );

  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(page.locator(".invitation-opening-content")).toBeFocused();

  // Content state: rendered from the single server-side retrieval.
  await expect(
    page.getByRole("heading", { name: "Smoke Guest" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "5C Smoke Ceremony" }),
  ).toBeVisible();
  await expect(page.getByText("5C Smoke Venue")).toBeVisible();
  await expect(page.getByText("1 Smoke Test Lane")).toBeVisible();
  expect(runFixtureCli<SmokeFixtureRead>("read").openCount).toBe(
    expectedOpenCount,
  );

  // Privacy: distinguish the identifiers the public contract allows from the
  // ones it forbids (docs/API-CONTRACT.md, "Public IDs"). `state.eventId` is
  // the public `events[].id` and is required in the payload because the browser
  // submits it as `eventSelections[].eventId`, so its presence is asserted
  // rather than rejected. The internal `Invitation.id` is not part of that
  // projection and stays forbidden, as does all hash/version material.
  const html = await page.content();
  const visibleText = await page.locator("body").innerText();

  for (const field of LEAKED_INTERNAL_FIELDS) {
    expect(html).not.toContain(field);
  }

  expect(html).toContain(state.eventId);
  expect(html).not.toContain(state.invitationId);
  expect(visibleText).not.toContain(state.publicCredential);
});

// ---------------------------------------------------------------------------
// Phase 6 — guest check-in pass / QR, against the real API and PostgreSQL.
//
// These run after the retrieval test above so its open-count expectation, which
// is measured from the seeded baseline, is unaffected by the extra page loads
// the lifecycle scenarios perform.
// ---------------------------------------------------------------------------

test("real backend: an accepted RSVP renders the canonical qrPayload and keeps it across an update", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvp();
  expect(passState()).toMatchObject({
    activePassCount: 0,
    rsvpStatus: null,
    rsvpVersion: null,
    totalPassCount: 0,
  });

  await openInvitation(page, state.publicCredential);

  // No RSVP yet: the pass must not be invented.
  await expectPassAbsent(page, null);

  await acceptInBrowser(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Thank you for your RSVP" }),
  ).toBeVisible();

  // Rendered from the client-side submit result, with no manual reload.
  const rendered = await expectPassVisible(page);

  const canonical = await fetchCanonicalRsvp(state.publicCredential);

  expect(canonical.rsvp).toMatchObject({ status: "ACCEPTED", version: 1 });
  expect(canonical.checkinPass?.status).toBe("ACTIVE");
  expect(canonical.checkinPass?.qrPayload).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // The DOM shows exactly the value the real API returned.
  expect(sameSecret(rendered, canonical.checkinPass!.qrPayload)).toBe(true);

  const afterAccept = passState();

  expect(afterAccept).toMatchObject({
    activeHashMatches: true,
    activePassCount: 1,
    rsvpStatus: "ACCEPTED",
    rsvpVersion: 1,
    totalPassCount: 1,
  });

  await expectNoPrivatePassFields(page, state, afterAccept.activePassIds);
  await expectNoBrowserPersistence(page, rendered);

  await editSaved(page);
  // An accepted update must retain the same pass and the same credential.
  await page
    .getByLabel(/Dietary requirements/)
    .fill("Smoke smoke-free household");
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Thank you for your RSVP" }),
  ).toBeVisible();

  const updated = await expectPassVisible(page);
  const afterUpdate = passState();

  expect(afterUpdate).toMatchObject({
    activeHashMatches: true,
    activePassCount: 1,
    rsvpVersion: 2,
    totalPassCount: 1,
  });
  expect(afterUpdate.activePassIds).toEqual(afterAccept.activePassIds);
  expect(sameSecret(updated, rendered)).toBe(true);

  resetRsvp();
});

test("real backend: decline removes the pass and reaccept issues a different credential", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvp();
  await openInvitation(page, state.publicCredential);
  await acceptInBrowser(page);

  const firstPayload = await expectPassVisible(page);
  const afterAccept = passState();

  expect(afterAccept.activePassCount).toBe(1);

  const firstPassId = afterAccept.activePassIds[0]!;

  await editSaved(page);
  // Decline.
  await page.getByRole("radio", { name: "Regretfully Decline" }).check();
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Thank you for letting us know" }),
  ).toBeVisible();
  await expectPassAbsent(page, firstPayload);

  const afterDecline = passState();

  expect(afterDecline).toMatchObject({
    activePassCount: 0,
    revokedPassCount: 1,
    rsvpStatus: "DECLINED",
    rsvpVersion: 2,
    revokedWithRevocationReasonCount: 1,
    totalPassCount: 1,
  });
  expect(afterDecline.revokedPassIds).toEqual([firstPassId]);

  const declinedCanonical = await fetchCanonicalRsvp(state.publicCredential);

  expect(declinedCanonical.checkinPass).toBeNull();

  await editSaved(page);
  // Reaccept: a new pass with a new credential; the revoked one stays revoked.
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await page
    .getByRole("checkbox", { name: SMOKE_INVITEE, exact: true })
    .check();
  await page.getByRole("checkbox", { name: SMOKE_EVENT, exact: true }).check();
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Thank you for your RSVP" }),
  ).toBeVisible();

  const secondPayload = await expectPassVisible(page);
  const afterReaccept = passState();

  expect(sameSecret(firstPayload, secondPayload)).toBe(false);
  expect(afterReaccept).toMatchObject({
    activeHashMatches: true,
    activePassCount: 1,
    revokedPassCount: 1,
    rsvpVersion: 3,
    totalPassCount: 2,
  });
  expect(afterReaccept.revokedPassIds).toEqual([firstPassId]);
  expect(afterReaccept.activePassIds).not.toEqual([firstPassId]);

  const reacceptedCanonical = await fetchCanonicalRsvp(state.publicCredential);

  expect(
    sameSecret(reacceptedCanonical.checkinPass!.qrPayload, firstPayload),
  ).toBe(false);

  // The revoked credential is never redisplayed anywhere in the DOM.
  const html = await page.content();

  expect(html.includes(firstPayload)).toBe(false);
  await expectNoPrivatePassFields(page, state, [
    ...afterReaccept.activePassIds,
    ...afterReaccept.revokedPassIds,
  ]);

  resetRsvp();
});

test("real backend: a stale version conflict suspends the pass until the latest RSVP is loaded", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvp();
  await openInvitation(page, state.publicCredential);
  await acceptInBrowser(page);

  const payload = await expectPassVisible(page);

  expect(passState().rsvpVersion).toBe(1);

  await editSaved(page);
  // Advance the version out of band through the real API while the browser
  // still holds the version 1 it loaded. The external write itself withdraws
  // the RSVP, so the "latest" state the browser can recover to has no pass.
  const external = await fetch(
    `${REAL_API_BASE_URL}/api/public/invitations/${state.publicCredential}/rsvp`,
    {
      body: JSON.stringify({
        attendees: [],
        dietaryNotes: null,
        eventSelections: [],
        expectedVersion: 1,
        status: "DECLINED",
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    },
  );

  expect(external.status).toBe(200);
  expect(passState().rsvpVersion).toBe(2);

  // The browser still holds version 1, so this submit is stale.
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();

  const conflict = page.getByRole("button", { name: "Reload latest RSVP" });

  await expect(conflict).toBeVisible();

  // Stale QR suspended immediately, and the stale credential is gone from the DOM.
  await expectPassAbsent(page, payload);

  await conflict.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "The latest RSVP has been loaded" }),
  ).toBeVisible();

  // The latest canonical state is DECLINED, so no pass returns.
  expect(passState().rsvpStatus).toBe("DECLINED");
  await expectPassAbsent(page, payload);

  resetRsvp();
});

test("real backend: a past deadline keeps the active pass and blocks further mutation", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvp();
  await openInvitation(page, state.publicCredential);
  await acceptInBrowser(page);

  const payload = await expectPassVisible(page);
  const before = passState();

  expect(before).toMatchObject({
    activeHashMatches: true,
    activePassCount: 1,
    rsvpVersion: 1,
  });

  runFixtureCli<{ status: string }>("set-deadline", ["past"]);

  try {
    // The read path stays open after the cutoff, so a fresh load still shows
    // the pass and does not revoke it.
    await openInvitation(page, state.publicCredential);

    const reloaded = await expectPassVisible(page);

    expect(sameSecret(reloaded, payload)).toBe(true);

    await expect(
      page.getByRole("button", { name: "Edit RSVP", exact: true }),
    ).toHaveCount(0);
    const denied = await fetch(
      `${REAL_API_BASE_URL}/api/public/invitations/${state.publicCredential}/rsvp`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "DECLINED",
          expectedVersion: 1,
          attendees: [],
          eventSelections: [],
          dietaryNotes: null,
        }),
      },
    );
    expect(denied.status).toBe(422);
    expect((await denied.json()).error.code).toBe("RSVP_DEADLINE_PASSED");

    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "The reply deadline has passed" }),
    ).toBeVisible();

    const after = passState();

    expect(after).toMatchObject({
      activeHashMatches: true,
      activePassCount: 1,
      revokedPassCount: 0,
      rsvpVersion: 1,
      totalPassCount: 1,
    });
    expect(after.activePassIds).toEqual(before.activePassIds);

    const canonical = await fetchCanonicalRsvp(state.publicCredential);

    expect(sameSecret(canonical.checkinPass!.qrPayload, payload)).toBe(true);
  } finally {
    runFixtureCli<{ status: string }>("set-deadline", ["none"]);
  }

  resetRsvp();
});

test("real backend: an unavailable invitation never renders a pass", async ({
  page,
}) => {
  // A lexically valid but unknown credential: same 404 classification as a
  // revoked link, and certainly no pass.
  const unknown = "Z".repeat(43);

  await page.goto(`/i/${unknown}`);

  await expect(
    page.getByRole("heading", { name: "Invitation unavailable" }),
  ).toBeVisible();
  await expectPassAbsent(page, null);
});

test("real backend: the guest QR is locally rendered, square, and quiet-zoned", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvp();
  await openInvitation(page, state.publicCredential);
  await acceptInBrowser(page);

  const payload = await expectPassVisible(page);
  const svg = passRegion(page).locator("svg");

  await expect(svg).toHaveCount(1);

  // Locally generated SVG: a real <svg> with module paths and no external
  // image or overlay/logo element.
  const markup = await svg.evaluate((element) => element.outerHTML);

  expect(markup).toContain("#000000");
  expect(markup).toContain("#ffffff");
  expect(await svg.locator("image").count()).toBe(0);
  expect(await svg.locator("path").count()).toBeGreaterThan(0);

  const box = await svg.boundingBox();

  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(Math.round(box!.height));

  // The renderer draws a full-bleed background path first and the modules
  // second. The viewBox is square and larger than the module grid, which is
  // where the quiet zone comes from (33 modules + 4 on each side = 41).
  const viewBox = await svg.getAttribute("viewBox");
  const [, , viewWidth, viewHeight] = (viewBox ?? "").split(/\s+/).map(Number);

  expect(viewWidth).toBe(viewHeight);

  // Quiet zone in rendered pixels: the modules never touch the SVG edge.
  const inset = await svg.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const paths = element.querySelectorAll("path");
    const modules = paths[paths.length - 1];

    if (modules === undefined) return null;

    const inner = modules.getBoundingClientRect();

    return {
      right: frame.right - inner.right,
      bottom: frame.bottom - inner.bottom,
      left: inner.left - frame.left,
      top: inner.top - frame.top,
    };
  });

  expect(inset).not.toBeNull();
  expect(inset!.left).toBeGreaterThan(0);
  expect(inset!.top).toBeGreaterThan(0);
  expect(inset!.right).toBeGreaterThan(0);
  expect(inset!.bottom).toBeGreaterThan(0);

  // High contrast: white background path first, black modules second.
  const fills = await svg.evaluate((element) =>
    Array.from(element.querySelectorAll("path"), (path) =>
      path.getAttribute("fill"),
    ),
  );

  expect(fills[0]).toBe("#ffffff");
  expect(fills[fills.length - 1]).toBe("#000000");

  // The textual fallback stays selectable and carries the same value.
  const code = passCode(page);

  await expect(code).toBeVisible();
  expect(
    await code.evaluate((element) => getComputedStyle(element).userSelect),
  ).not.toBe("none");
  expect(sameSecret((await code.innerText()).trim(), payload)).toBe(true);

  // Accessibility of the real rendered pass: the section is a landmark named
  // by its heading, the QR carries an accessible name, and the code is labelled
  // rather than presenting the credential as unlabelled text.
  await expect(page.getByRole("region", { name: PASS_REGION })).toHaveCount(1);
  await expect(page.getByRole("img", { name: QR_NAME })).toHaveCount(1);
  await expect(page.getByLabel("Check-in code")).toHaveCount(1);

  const labelledBy = await code.getAttribute("aria-labelledby");
  const labelText = await page.locator(`#${labelledBy}`).innerText();

  expect(labelText.trim()).toBe("Check-in code");

  // The accepted state is conveyed in text, not by the QR image alone.
  await expect(
    passRegion(page).getByText("Your acceptance is saved.", { exact: false }),
  ).toBeVisible();

  await editSaved(page);
  // The RSVP controls stay keyboard operable with the pass present.
  await page.getByRole("radio", { name: "Joyfully Accept" }).focus();
  await page.keyboard.press("Tab");

  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("type") ?? "",
  );

  expect([
    "radio",
    "checkbox",
    "text",
    "number",
    "submit",
    "textarea",
  ]).toContain(focused);

  resetRsvp();
});

test("real backend: the guest pass fits every supported viewport without overflow", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvp();
  await openInvitation(page, state.publicCredential);
  await acceptInBrowser(page);
  await expectPassVisible(page);

  for (const width of [320, 375, 412, 768, 1280]) {
    await page.setViewportSize({ height: 900, width });

    const region = passRegion(page);

    await expect(region).toHaveCount(1);
    await expect(region.getByRole("img", { name: QR_NAME })).toBeVisible();
    await expect(passCode(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit RSVP", exact: true }),
    ).toBeEnabled();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );

    expect(overflow).toBeLessThanOrEqual(1);

    const qr = await region.getByRole("img", { name: QR_NAME }).boundingBox();
    const invitation = await page.locator("body").boundingBox();

    expect(qr).not.toBeNull();
    expect(invitation).not.toBeNull();
    expect(Math.round(qr!.width)).toBe(Math.round(qr!.height));

    // The QR stays inside the page rather than spilling past the viewport.
    expect(qr!.x).toBeGreaterThanOrEqual(0);
    expect(qr!.x + qr!.width).toBeLessThanOrEqual(width + 1);
  }

  resetRsvp();
});

test("real backend: the guest credential stays out of URLs, requests, and the console", async ({
  page,
}) => {
  const state = readSmokeState();
  const requests: string[] = [];
  const consoleOutput: string[] = [];
  const pageErrors: string[] = [];

  resetRsvp();

  page.on("request", (request) => {
    requests.push(`${request.method()} ${request.url()}`);
  });
  page.on("console", (message) => {
    consoleOutput.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await openInvitation(page, state.publicCredential);
  await acceptInBrowser(page);

  const payload = await expectPassVisible(page);

  // No request — same-origin or third party — may carry the credential. This
  // also rules out any remote QR rendering service.
  for (const entry of requests) {
    expect(entry.includes(payload)).toBe(false);
  }

  const externalQrHosts = requests.filter((entry) =>
    /qrserver|quickchart|googleapis|chart\.google|api\.qr|qr-code/.test(entry),
  );

  expect(externalQrHosts).toEqual([]);

  const url = new URL(page.url());

  expect(sameSecret(url.pathname, `/i/${state.publicCredential}`)).toBe(true);
  expect(url.search).toBe("");
  expect(url.hash).toBe("");

  // The invitation route credential is the established public credential and is
  // a different value from the Phase 6 pass credential.
  expect(sameSecret(url.pathname, `/i/${payload}`)).toBe(false);

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href], img[src]")).map(
      (element) =>
        element.getAttribute("href") ?? element.getAttribute("src") ?? "",
    ),
  );

  for (const href of hrefs) {
    expect(href.includes(payload)).toBe(false);
  }

  for (const line of [...consoleOutput, ...pageErrors]) {
    expect(line.includes(payload)).toBe(false);
  }

  expect(pageErrors).toEqual([]);

  await expectNoBrowserPersistence(page, payload);
  await expectNoPrivatePassFields(page, state, passState().activePassIds);

  resetRsvp();
});

// ---------------------------------------------------------------------------
// Phase 7 — guest messages, real browser against the compiled API and the
// isolated real PostgreSQL smoke database.
//
// These run last on purpose: the retrieval test above asserts `open_count` as
// an exact delta from the seeded baseline, so an earlier page load in this file
// would invalidate it. That is also why the Phase 7 HTTP matrix lives in its
// own page-load-free file.
//
// Privacy: guest message content and `authorName` are user-authored personal
// content. The synthetic constants below live only in test source; they are
// never printed, never part of a test title, and never interpolated into an
// assertion message. DB-side content equality is proven with SHA-256 digests.
// ---------------------------------------------------------------------------

const GUEST_MESSAGE_HEADING = "Leave a Message for the Bride & Groom";
const GUEST_MESSAGE_SUCCESS = "Message Sent!";
const GUEST_MESSAGE_FORM = "Guest message";

const AUTHOR_WITH_PADDING = "  Smoke Author  ";
const AUTHOR_NORMALIZED = "Smoke Author";
const MESSAGE_WITH_PADDING = "  First line\nSecond line  ";
const MESSAGE_NORMALIZED = "First line\nSecond line";
const SCRIPT_MESSAGE = "<script>window.__xss = 1</script> plain text";
const EMOJI = "😀";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function messageState(): SmokeMessageState {
  return runFixtureCli<SmokeMessageState>("message-state");
}

function resetMessages(): void {
  runFixtureCli<{ status: string }>("reset-messages");
}

function setInvitationStatus(status: "active" | "archived"): void {
  runFixtureCli<{ status: string }>("set-invitation-status", [status]);
}

function resetRsvpAndMessages(): void {
  runFixtureCli<{ status: string }>("reset-rsvp");
  resetMessages();
}

function guestMessageForm(page: Page) {
  return page.getByRole("form", { name: GUEST_MESSAGE_FORM });
}

/** Scoped to the guest-message component so the RSVP notices never match. */
function guestMessageAlert(page: Page) {
  return page.locator(".guest-message-form").getByRole("alert");
}

function sendButton(page: Page) {
  return page.getByRole("button", { name: /^Send Message/ });
}

async function openMessageForm(page: Page, publicCredential: string) {
  await openInvitation(page, publicCredential);

  await expect(guestMessageForm(page)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_HEADING }),
  ).toBeVisible();
}

async function fillMessage(
  page: Page,
  authorName: string | null,
  message: string,
): Promise<void> {
  if (authorName !== null) {
    await page.getByLabel(/Your name/).fill(authorName);
  }

  await page.getByLabel(/Your message/).fill(message);
}

/**
 * A Next server action arrives as a POST to the page route. The header name is
 * not stable across Next versions, so it is matched case-insensitively instead
 * of by exact spelling.
 */
function isServerActionRequest(request: {
  headers: () => Record<string, string>;
  method: () => string;
}): boolean {
  return (
    request.method() === "POST" &&
    Object.keys(request.headers()).some(
      (header) => header.toLowerCase() === "next-action",
    )
  );
}

test("real backend: the message section renders a real form and no placeholder", async ({
  page,
}) => {
  const state = readSmokeState();

  await openMessageForm(page, state.publicCredential);

  await expect(guestMessageForm(page).locator("textarea")).toHaveCount(1);
  await expect(page.getByLabel(/Your name/)).toBeVisible();
  await expect(sendButton(page)).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toHaveCount(0);

  // No placeholder copy survives, and no public message history is rendered.
  const visibleText = await page.locator("body").innerText();

  expect(/coming soon|later phase|stay tuned/i.test(visibleText)).toBe(false);
  await expect(page.getByText("See you at the Wedding!")).toBeVisible();
});

test("real backend: a named multiline message is persisted and confirmed in the browser", async ({
  page,
}) => {
  const state = readSmokeState();
  const pageErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_WITH_PADDING, MESSAGE_WITH_PADDING);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Thank you for your message. The bride and groom look forward to reading all your warm wishes after the celebration.",
    ),
  ).toBeVisible();

  // No route change: the confirmation is an in-place state on the same page.
  expect(new URL(page.url()).pathname).toBe(`/i/${state.publicCredential}`);

  const after = messageState();

  expect(after.messageCount).toBe(1);

  const [row] = after.messages;

  expect(row!.authorNamePresent).toBe(true);
  expect(row!.authorNameIsTrimmed).toBe(true);
  expect(row!.messageIsTrimmed).toBe(true);
  expect(row!.messageHasNewline).toBe(true);
  expect(row!.invitationIdMatches).toBe(true);
  expect(row!.isHidden).toBe(false);
  expect(row!.authorNameSha256).toBe(sha256(AUTHOR_NORMALIZED));
  expect(row!.messageSha256).toBe(sha256(MESSAGE_NORMALIZED));

  expect(pageErrors).toEqual([]);
});

test("real backend: an anonymous message is accepted and stored without an author", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, null, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const after = messageState();

  expect(after.messageCount).toBe(1);
  expect(after.messages[0]!.authorNamePresent).toBe(false);
});

test("real backend: Back to Invitation restores an empty usable form and a second submission appends", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to Invitation" }).click();

  // The confirmation closes and a blank, usable form returns.
  await expect(guestMessageForm(page)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toHaveCount(0);
  await expect(page.getByLabel(/Your name/)).toHaveValue("");
  await expect(page.getByLabel(/Your message/)).toHaveValue("");
  await expect(sendButton(page)).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe(`/i/${state.publicCredential}`);

  // A later explicit submission is a new request, not a locked-out one.
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const after = messageState();

  expect(after.messageCount).toBe(2);
  expect(after.messages[0]!.id).not.toBe(after.messages[1]!.id);
});

test("real backend: client validation blocks invalid content before any request", async ({
  page,
}) => {
  const state = readSmokeState();
  let requests = 0;

  resetMessages();

  page.on("request", (request) => {
    if (isServerActionRequest(request)) requests += 1;
  });

  await openMessageForm(page, state.publicCredential);

  // Blank message.
  await fillMessage(page, AUTHOR_NORMALIZED, "   ");
  await sendButton(page).click();
  await expect(
    guestMessageAlert(page).filter({
      hasText: "Please write a message for the bride and groom.",
    }),
  ).toBeVisible();
  expect(requests).toBe(0);

  // One code point over the message cap.
  await fillMessage(page, AUTHOR_NORMALIZED, EMOJI.repeat(1001));
  await sendButton(page).click();
  await expect(page.getByText(/keep your message to 1000/)).toBeVisible();
  expect(requests).toBe(0);

  // One code point over the author-name cap.
  await fillMessage(page, EMOJI.repeat(101), MESSAGE_NORMALIZED);
  await sendButton(page).click();
  await expect(page.getByText(/keep your name to 100/)).toBeVisible();
  expect(requests).toBe(0);

  expect(messageState().messageCount).toBe(0);

  // Exactly at both caps is accepted and does reach the server.
  await fillMessage(page, EMOJI.repeat(100), EMOJI.repeat(1000));
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();
  expect(requests).toBe(1);

  const after = messageState();

  expect(after.messageCount).toBe(1);
  expect(after.messages[0]!.messageCodePoints).toBe(1000);
  expect(after.messages[0]!.authorNameCodePoints).toBe(100);
});

test("real backend: a pending submission is not duplicated by repeated clicks", async ({
  page,
}) => {
  const state = readSmokeState();
  let requests = 0;

  resetMessages();

  page.on("request", (request) => {
    if (isServerActionRequest(request)) requests += 1;
  });

  // Hold the response so the pending window is observable rather than a race.
  await page.route("**/*", async (route) => {
    if (isServerActionRequest(route.request())) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    await route.continue();
  });

  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);

  await sendButton(page).click();

  // The pending state is real, and the control is disabled during it.
  await expect(page.getByRole("button", { name: /^Sending/ })).toBeDisabled();
  expect(requests).toBe(1);

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  // Client-side pending protection only: one request, one row. This is not
  // backend deduplication, and a deliberate later retry still appends.
  expect(requests).toBe(1);
  expect(messageState().messageCount).toBe(1);
});

test("real backend: a rejected submission keeps the draft and retries explicitly", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);

  try {
    // The invitation closes mid-session, after the page was already rendered.
    setInvitationStatus("archived");
    await sendButton(page).click();

    await expect(
      page.getByText("This invitation is currently unavailable."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
    ).toHaveCount(0);

    // The draft survives the failure; nothing was silently retried.
    await expect(page.getByLabel(/Your name/)).toHaveValue(AUTHOR_NORMALIZED);
    await expect(page.getByLabel(/Your message/)).toHaveValue(
      MESSAGE_NORMALIZED,
    );
    expect(messageState().messageCount).toBe(0);
  } finally {
    setInvitationStatus("active");
  }

  // The explicit retry is a new user action and succeeds.
  await page.getByRole("button", { name: "Send Message Again" }).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const after = messageState();

  expect(after.messageCount).toBe(1);
  expect(after.messages[0]!.messageSha256).toBe(sha256(MESSAGE_NORMALIZED));
});

test("real backend: a response lost after a committed write never claims success and never auto-retries", async ({
  page,
}) => {
  const state = readSmokeState();
  let requests = 0;

  resetMessages();

  page.on("request", (request) => {
    if (isServerActionRequest(request)) requests += 1;
  });

  // The request is performed for real — so the append commits — and only then
  // is the browser's response dropped. This is the exact uncertain case: the
  // guest cannot tell whether the message was saved.
  await page.route("**/*", async (route) => {
    if (!isServerActionRequest(route.request())) {
      await route.continue();
      return;
    }

    await route.fetch();
    await route.abort("failed");
  });

  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByText("We couldn’t confirm whether your message was sent."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toHaveCount(0);

  // Draft preserved, no automatic retry, and the result is genuinely unknown.
  await expect(page.getByLabel(/Your message/)).toHaveValue(MESSAGE_NORMALIZED);
  expect(requests).toBe(1);

  // The write did commit server-side — which is exactly why no automatic retry
  // is allowed here, and why the copy warns that sending again may produce a
  // second copy.
  expect(messageState().messageCount).toBe(1);
});

test("real backend: guest messages stay available after a decline and past the RSVP deadline", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvpAndMessages();

  await openMessageForm(page, state.publicCredential);
  await page.getByRole("radio", { name: "Regretfully Decline" }).check();
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Thank you for letting us know" }),
  ).toBeVisible();

  expect(passState().rsvpStatus).toBe("DECLINED");

  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  // The message write did not disturb the RSVP it is independent of.
  expect(passState().rsvpStatus).toBe("DECLINED");

  // Re-accept so a reloaded form is in the editable ACCEPTED shape; a declined
  // RSVP renders a summary without the dietary field, which is not what this
  // leg is measuring.
  await acceptInBrowser(page);
  await expect(
    page.getByRole("status").filter({ hasText: "Thank you for your RSVP" }),
  ).toBeVisible();

  runFixtureCli<{ status: string }>("set-deadline", ["past"]);

  try {
    // A fresh load past the cutoff. The RSVP controls are still closed...
    await openMessageForm(page, state.publicCredential);
    await expect(
      page.getByRole("button", { name: "Edit RSVP", exact: true }),
    ).toHaveCount(0);
    const denied = await fetch(
      `${REAL_API_BASE_URL}/api/public/invitations/${state.publicCredential}/rsvp`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "DECLINED",
          expectedVersion: 1,
          attendees: [],
          eventSelections: [],
          dietaryNotes: null,
        }),
      },
    );
    expect(denied.status).toBe(422);
    expect((await denied.json()).error.code).toBe("RSVP_DEADLINE_PASSED");
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "The reply deadline has passed" }),
    ).toBeVisible();

    // ...and the guest message path is not.
    await fillMessage(page, null, MESSAGE_NORMALIZED);
    await sendButton(page).click();

    await expect(
      page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
    ).toBeVisible();
  } finally {
    runFixtureCli<{ status: string }>("set-deadline", ["none"]);
  }

  expect(messageState().messageCount).toBe(2);

  resetRsvpAndMessages();
});

test("real backend: a guest message leaves the check-in pass and its qrPayload untouched", async ({
  page,
}) => {
  const state = readSmokeState();

  resetRsvpAndMessages();

  await openInvitation(page, state.publicCredential);
  await acceptInBrowser(page);

  const payload = await expectPassVisible(page);
  const before = passState();

  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  // The pass survives the message write with the same credential.
  const afterPayload = await expectPassVisible(page);

  expect(sameSecret(afterPayload, payload)).toBe(true);

  const after = passState();

  expect(after).toMatchObject({
    activeHashMatches: true,
    activePassCount: 1,
    rsvpStatus: "ACCEPTED",
    rsvpVersion: before.rsvpVersion,
    totalPassCount: before.totalPassCount,
  });
  expect(after.activePassIds).toEqual(before.activePassIds);

  resetRsvpAndMessages();
});

test("real backend: script-like message content never executes and never renders", async ({
  page,
}) => {
  const state = readSmokeState();
  const dialogs: string[] = [];
  const pageErrors: string[] = [];

  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.dismiss();
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  resetMessages();
  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, SCRIPT_MESSAGE);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const xss = await page.evaluate(
    () => (window as unknown as Record<string, unknown>).__xss ?? null,
  );

  expect(xss).toBe(null);
  expect(dialogs).toEqual([]);
  expect(pageErrors).toEqual([]);

  // Stored verbatim, never interpreted, and never rendered back to the public.
  const html = await page.content();

  expect(html.includes(SCRIPT_MESSAGE)).toBe(false);
  expect(html.includes("__xss")).toBe(false);

  const after = messageState();

  expect(after.messageCount).toBe(1);
  expect(after.messages[0]!.messageSha256).toBe(sha256(SCRIPT_MESSAGE));

  resetMessages();
});

test("real backend: guest content stays out of storage, URLs, and third-party requests", async ({
  page,
}) => {
  const state = readSmokeState();
  const requests: string[] = [];
  const consoleOutput: string[] = [];
  const pageErrors: string[] = [];

  resetMessages();

  page.on("request", (request) => {
    requests.push(`${request.method()} ${request.url()}`);
  });
  page.on("console", (message) => {
    consoleOutput.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await openMessageForm(page, state.publicCredential);
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  await expect(
    page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS }),
  ).toBeVisible();

  const secrets = [AUTHOR_NORMALIZED, MESSAGE_NORMALIZED];

  // Guest content never reaches a URL, encoded or raw.
  for (const entry of requests) {
    for (const value of secrets) {
      expect(entry.includes(encodeURIComponent(value))).toBe(false);
      expect(entry.includes(value)).toBe(false);
    }
  }

  // No third-party destination of any kind is contacted.
  expect(requests.filter((entry) => !entry.includes("localhost:3000"))).toEqual(
    [],
  );

  const stored = await page.evaluate(() => ({
    cookie: document.cookie,
    localStorage: JSON.stringify(window.localStorage),
    sessionStorage: JSON.stringify(window.sessionStorage),
  }));

  for (const value of secrets) {
    expect(stored.localStorage.includes(value)).toBe(false);
    expect(stored.sessionStorage.includes(value)).toBe(false);
    expect(stored.cookie.includes(value)).toBe(false);
  }

  // No content in the URL, and the credential route is unchanged.
  const url = new URL(page.url());

  expect(sameSecret(url.pathname, `/i/${state.publicCredential}`)).toBe(true);
  expect(url.search).toBe("");
  expect(url.hash).toBe("");

  for (const line of [...consoleOutput, ...pageErrors]) {
    for (const value of secrets) {
      expect(line.includes(value)).toBe(false);
    }
  }

  expect(pageErrors).toEqual([]);

  resetMessages();
});

test("real backend: the message form and confirmation fit every supported viewport", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);

  for (const width of [320, 375, 412, 768, 1280]) {
    await page.setViewportSize({ height: 900, width });

    await expect(
      page.getByRole("heading", { name: GUEST_MESSAGE_HEADING }),
    ).toBeVisible();
    await expect(page.getByLabel(/Your name/)).toBeVisible();
    await expect(guestMessageForm(page).locator("textarea")).toBeVisible();
    await expect(sendButton(page)).toBeEnabled();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);

    const field = await page.getByLabel(/Your message/).boundingBox();

    expect(field).not.toBeNull();
    expect(field!.x).toBeGreaterThanOrEqual(0);
    expect(field!.x + field!.width).toBeLessThanOrEqual(width + 1);
  }

  // The confirmation state also fits the narrowest supported width.
  await page.setViewportSize({ height: 900, width: 320 });
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  const success = page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS });

  await expect(success).toBeVisible();

  const box = await success.boundingBox();

  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(321);
  await expect(
    page.getByRole("button", { name: "Back to Invitation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);

  resetMessages();
});

test("real backend: the message form is labelled, associated, and keyboard operable", async ({
  page,
}) => {
  const state = readSmokeState();

  resetMessages();
  await openMessageForm(page, state.publicCredential);

  const message = page.getByLabel(/Your message/);

  // Real labels, and the required/optional semantics are in the accessible name.
  await expect(page.getByLabel(/Your name \(optional\)/)).toBeVisible();
  await expect(page.getByLabel(/Your message \(required\)/)).toBeVisible();
  await expect(message).toHaveAttribute("required", "");

  // Limits are associated with the field, not decorative.
  const describedBy = await message.getAttribute("aria-describedby");

  await expect(page.locator(`#${describedBy!.split(" ")[0]}`)).toContainText(
    "1000",
  );

  // The textarea accepts keyboard input.
  await message.focus();
  await page.keyboard.type("Keyboard entry");
  await expect(message).toHaveValue("Keyboard entry");

  // A validation failure is exposed with aria-invalid and an alert.
  await message.fill("   ");
  await sendButton(page).click();

  await expect(message).toHaveAttribute("aria-invalid", "true");
  await expect(
    guestMessageAlert(page).filter({
      hasText: "Please write a message for the bride and groom.",
    }),
  ).toBeVisible();

  // Success moves focus to the confirmation heading, so it is announced.
  await fillMessage(page, AUTHOR_NORMALIZED, MESSAGE_NORMALIZED);
  await sendButton(page).click();

  const success = page.getByRole("heading", { name: GUEST_MESSAGE_SUCCESS });

  await expect(success).toBeVisible();
  await expect(success).toBeFocused();

  // Back to Invitation is keyboard reachable and returns focus into the form.
  await page.getByRole("button", { name: "Back to Invitation" }).focus();
  await page.keyboard.press("Enter");

  await expect(guestMessageForm(page)).toBeVisible();
  await expect(page.getByLabel(/Your name/)).toBeFocused();

  resetMessages();
});
