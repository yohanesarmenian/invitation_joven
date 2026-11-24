import { MOCK_API_ORIGIN } from "./harness";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import type { SubmitPublicRsvpRequest } from "../../../packages/api-client/src/index";

const MOCK = MOCK_API_ORIGIN;
const PATH = `/i/${"A".repeat(43)}`;
const browserErrors = new WeakMap<Page, string[]>();
const accepted = {
  status: "ACCEPTED",
  version: 7,
  partyMode: "PLUS_ONE",
  dietaryNotes: "No seafood",
  attendeeQuantityTotal: 2,
  attendees: [
    { type: "NAMED_INVITEE", inviteeId: "invitee-test-1", quantity: 1 },
    { type: "PLUS_ONE", inviteeId: null, quantity: 1 },
  ],
  eventSelections: [
    { eventId: "event-test-1", attending: true, expectedAttendeeCount: 2 },
    { eventId: "event-test-2", attending: false, expectedAttendeeCount: 0 },
  ],
};

async function configure(request: APIRequestContext, data: unknown) {
  expect((await request.post(`${MOCK}/__rsvp-fixture`, { data })).ok()).toBe(
    true,
  );
}

async function submissions(
  request: APIRequestContext,
): Promise<SubmitPublicRsvpRequest[]> {
  const response = await request.get(`${MOCK}/__rsvp-state`);
  return (await response.json()).requests;
}

async function open(page: Page) {
  await page.goto(PATH);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
}

function heroAction(page: Page, name: string) {
  return page
    .locator(".invitation-hero")
    .getByRole("link", { name, exact: true });
}

async function editSaved(page: Page) {
  await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit RSVP", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save Changes", exact: true }),
  ).toBeVisible();
  await expectPass(page, null);
}

async function accept(page: Page) {
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await page
    .getByRole("radio", { name: "Holy Matrimony Test", exact: true })
    .check();
  await page
    .getByRole("radio", { name: "I’ll attend on my own", exact: true })
    .check();
}

const firstPass = "fixture-pass-1-".padEnd(43, "x");
const secondPass = "fixture-pass-2-".padEnd(43, "x");

async function expectPass(page: Page, payload: string | null) {
  const pass = page.getByRole("region", { name: "Your check-in pass" });
  if (payload === null) {
    await expect(pass).toHaveCount(0);
    await expect(page.locator(".checkin-code")).toHaveCount(0);
  } else {
    await expect(pass).toHaveCount(1);
    await expect(
      pass.getByRole("heading", { name: "Your check-in pass" }),
    ).toBeVisible();
    await expect(
      pass.getByRole("img", { name: "Household check-in pass QR code" }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await pass.locator(".checkin-code").textContent()) === payload,
      )
      .toBe(true);
    await expect(
      pass.getByText("Check-in code", { exact: true }),
    ).toBeVisible();
    await expect(pass.locator("a, input, [hidden]")).toHaveCount(0);
  }
  // The application must not duplicate the credential into element attributes.
  expect(
    await page
      .locator(".public-rsvp-form")
      .evaluate((form) =>
        [...form.querySelectorAll("*")].some((element) =>
          [...element.attributes].some((attribute) =>
            attribute.value.includes("fixture-pass-"),
          ),
        ),
      ),
  ).toBe(false);
}

async function assertPassLayout(page: Page) {
  const pass = page.locator(".guest-checkin-pass");
  await page.evaluate(() => document.fonts.ready);
  await pass.scrollIntoViewIfNeeded();
  await pass.locator("img").evaluateAll((nodes) => {
    nodes.forEach((node) => {
      (node as HTMLImageElement).loading = "eager";
    });
  });
  await expect
    .poll(() =>
      pass.locator("img").evaluateAll(
        (nodes) =>
          nodes.filter((node) => {
            const image = node as HTMLImageElement;
            return !image.complete || image.naturalWidth === 0;
          }).length,
      ),
    )
    .toBe(0);
  const geometry = await pass.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const qr = element.querySelector("svg")!.getBoundingClientRect();
    const code = element.querySelector("code")!;
    return {
      square: Math.abs(qr.width - qr.height) < 1,
      readableSize: qr.width >= 200,
      contained:
        qr.left >= box.left &&
        qr.right <= box.right &&
        box.left >= 0 &&
        box.right <= innerWidth,
      wraps:
        getComputedStyle(code).overflowWrap === "anywhere" &&
        code.scrollWidth <= code.clientWidth,
      selectable: getComputedStyle(code).userSelect === "text",
      overlaps: [
        ...document.querySelectorAll(
          ".rsvp-information-section .invitation-decoration",
        ),
      ].some((art) => {
        const rect = art.getBoundingClientRect();
        return (
          rect.left < qr.right &&
          rect.right > qr.left &&
          rect.top < qr.bottom &&
          rect.bottom > qr.top
        );
      }),
    };
  });
  expect(geometry).toEqual({
    square: true,
    readableSize: true,
    contained: true,
    wraps: true,
    selectable: true,
    overlaps: false,
  });
  // Geometry assertions provide QR layout proof without capturing bearer material.
}

test.beforeEach(async ({ request, page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  expect((await request.post(`${MOCK}/__reset`)).status()).toBe(204);
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
  expect(page.url().includes("fixture-pass-")).toBe(false);
  expect(
    await page.evaluate(() =>
      [
        JSON.stringify(localStorage),
        JSON.stringify(sessionStorage),
        document.cookie,
      ].some((value) => value.includes("fixture-pass-")),
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

async function noticeScreenshot(page: Page, info: TestInfo, name: string) {
  const notice = page.locator(".rsvp-notice");
  await expect(notice).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  const layout = await notice.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      clipped:
        box.left < 0 ||
        box.right > innerWidth ||
        element.scrollWidth > element.clientWidth + 1,
      smallActions: [...element.querySelectorAll("button")].some(
        (button) => button.getBoundingClientRect().height < 44,
      ),
      overlaps: [
        ...document.querySelectorAll(
          ".rsvp-information-section .invitation-decoration",
        ),
      ].some((art) => {
        const rect = art.getBoundingClientRect();
        return (
          rect.left < box.right &&
          rect.right > box.left &&
          rect.top < box.bottom &&
          rect.bottom > box.top
        );
      }),
    };
  });
  expect(layout).toEqual({
    clipped: false,
    smallActions: false,
    overlaps: false,
  });
  await notice.screenshot({
    path: info.outputPath(`${name}.png`),
    animations: "disabled",
  });
}

for (const width of [320, 375, 412, 768, 1280]) {
  test(`RSVP create, edit and decline at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await configure(request, {
      rules: { allowPlusOne: true, maxAdditionalChildren: 2 },
      nextVersion: 42,
    });
    await open(page);
    await expect(heroAction(page, "Confirm Attendance")).toBeVisible();
    await expectPass(page, null);
    const form = page.getByRole("form", { name: "Your RSVP" });
    await expect(form.locator("input:checked")).toHaveCount(0);
    await accept(page);
    await expect(heroAction(page, "Confirm Attendance")).toBeVisible();
    await page
      .getByRole("radio", {
        name: "Holy Matrimony Test & Reception Test",
        exact: true,
      })
      .check();
    await page
      .getByRole("radio", { name: "I’ll attend with family", exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "Include one additional partner" })
      .check();
    await page.getByRole("checkbox", { name: "Include children" }).check();
    await page
      .getByRole("spinbutton", { name: /Additional children/ })
      .fill("2");
    const dietary = page.getByRole("textbox", {
      name: "Dietary requirements (optional)",
    });
    await dietary.fill("No seafood");
    await expect(
      page.getByText("4 people expected at each selected session."),
    ).toBeVisible();
    await expect(dietary).toHaveAttribute("maxlength", "500");
    await dietary.fill("x".repeat(501));
    await expect(dietary).toHaveValue("x".repeat(500));
    await dietary.fill("  No seafood  ");

    // Inspect inner form geometry too: the invitation surface clips overflow.
    const geometry = await form.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const controls = [
        ...element.querySelectorAll("input, textarea, button, label"),
      ];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: controls.some((control) => {
          const rect = control.getBoundingClientRect();
          return rect.left < box.left - 1 || rect.right > box.right + 1;
        }),
        smallTargets: [
          ...element.querySelectorAll(
            '.rsvp-choice, input[type="number"], textarea, button',
          ),
        ].filter((control) => control.getBoundingClientRect().height < 44)
          .length,
        decorationOverlap: [
          ...document.querySelectorAll(
            ".rsvp-information-section .invitation-decoration",
          ),
        ].some((decoration) => {
          const art = decoration.getBoundingClientRect();
          return controls.some((control) => {
            const rect = control.getBoundingClientRect();
            return (
              rect.left < art.right &&
              rect.right > art.left &&
              rect.top < art.bottom &&
              rect.bottom > art.top
            );
          });
        }),
      };
    });
    expect(geometry).toEqual({
      overflow: false,
      clipped: false,
      smallTargets: 0,
      decorationOverlap: false,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".rsvp-information-section").screenshot({
      path: testInfo.outputPath(`rsvp-${width}.png`),
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Your acceptance has been saved.");
    expect((await submissions(request))[0]).toEqual({
      expectedVersion: null,
      status: "ACCEPTED",
      partyMode: "FAMILY",
      attendees: [
        { type: "NAMED_INVITEE", inviteeId: "invitee-test-1", quantity: 1 },
        { type: "PLUS_ONE", inviteeId: null, quantity: 1 },
        { type: "ADDITIONAL_CHILD", inviteeId: null, quantity: 2 },
      ],
      eventSelections: [
        { eventId: "event-test-1", attending: true, expectedAttendeeCount: 4 },
        { eventId: "event-test-2", attending: true, expectedAttendeeCount: 4 },
      ],
      dietaryNotes: "No seafood",
    });
    await expect(
      page.getByRole("heading", { name: "Attendance Confirmed", exact: true }),
    ).toBeVisible();
    await expect(dietary).toHaveCount(0);
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("before the reply deadline");
    await noticeScreenshot(page, testInfo, `accepted-${width}`);
    await expectPass(page, firstPass);
    await expect(heroAction(page, "View Check-in QR")).toBeVisible();
    await assertPassLayout(page);
    const originalModules = await page
      .locator(".guest-checkin-pass svg")
      .innerHTML();
    await editSaved(page);
    await page.getByRole("form", { name: "Your RSVP" }).screenshot({
      path: testInfo.outputPath(`rsvp-edit-${width}.png`),
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expectPass(page, firstPass);
    await page.getByRole("button", { name: "Edit RSVP", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expectPass(page, null);
    await expect(dietary).toHaveValue("No seafood");
    await page
      .getByRole("radio", { name: "Holy Matrimony Test", exact: true })
      .check();
    await dietary.fill("");
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).not.toContainText("saved");
    await page
      .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Your acceptance has been saved.");
    const update = (await submissions(request))[1]!;
    expect(update.expectedVersion).toBe(42);
    expect(update.dietaryNotes).toBeNull();
    expect(update.eventSelections).toEqual([
      { eventId: "event-test-1", attending: true, expectedAttendeeCount: 4 },
    ]);
    expect(update).not.toHaveProperty("guestNote");
    await expectPass(page, firstPass);
    expect(
      (await page.locator(".guest-checkin-pass svg").innerHTML()) ===
        originalModules,
    ).toBe(true);

    // Re-read dedicated RSVP state on a new invitation load.
    await open(page);
    await expectPass(page, firstPass);
    await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
    await editSaved(page);
    await expect(
      page.getByRole("radio", { name: "Joyfully Accept" }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", { name: "Holy Matrimony Test", exact: true }),
    ).toBeChecked();
    await page.getByRole("radio", { name: "Regretfully Decline" }).check();
    await expect(dietary).toHaveCount(0);
    await page.getByRole("radio", { name: "Joyfully Accept" }).check();
    await expect(
      page.getByRole("radio", { name: "Holy Matrimony Test", exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("spinbutton", { name: /Additional children/ }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "Regretfully Decline" }).check();
    await page
      .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Your response has been saved as not attending.");
    expect((await submissions(request))[2]).toEqual({
      expectedVersion: 43,
      status: "DECLINED",
      attendees: [],
      eventSelections: [],
      dietaryNotes: null,
    });
    await noticeScreenshot(page, testInfo, `declined-${width}`);
    await expectPass(page, null);
    await expect(heroAction(page, "View RSVP Response")).toBeVisible();
    expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
      false,
    );
    await editSaved(page);
    await page.getByRole("radio", { name: "Joyfully Accept" }).check();
    await expect(dietary).toHaveCount(0);
    await accept(page);
    await page
      .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Your acceptance has been saved.");
    await expectPass(page, secondPass);
    expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
      false,
    );
    expect(
      (await page.locator(".guest-checkin-pass svg").innerHTML()) ===
        originalModules,
    ).toBe(false);
    expect((await submissions(request))[3]!.expectedVersion).toBe(44);
    expect(errors).toEqual([]);
    await expect(
      page.locator(
        ".guest-message-section input, .guest-message-section textarea",
      ),
    ).toHaveCount(2);
    await expect(page.locator("body")).not.toContainText("A".repeat(43));
  });
}

test("validates progressive choice and incomplete family before a request", async ({
  page,
  request,
}) => {
  await configure(request, {
    rules: { allowPlusOne: true, maxAdditionalChildren: 2 },
  });
  await open(page);
  const send = page.getByRole("button", { name: "Submit RSVP", exact: true });
  const alert = page.locator(".rsvp-information-section").getByRole("alert");
  await send.click();
  await expect(alert).toContainText("Please choose whether you can join us.");
  await expect(alert).toBeFocused();
  await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveAttribute(
    "aria-describedby",
    /error/,
  );
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await send.click();
  await expect(alert).toContainText("Please choose the wedding sessions");
  await page
    .getByRole("radio", { name: "Holy Matrimony Test", exact: true })
    .check();
  await send.click();
  await expect(alert).toContainText("Please choose who will attend.");
  await page
    .getByRole("radio", { name: "I’ll attend with family", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Include children", exact: true })
    .check();
  await send.click();
  await expect(alert).toContainText(
    "Please select the invited children or enter the number",
  );
  const count = page.getByRole("spinbutton", { name: /Additional children/ });
  await count.fill("3");
  await send.click();
  await expect(alert).toContainText(
    "Please check the number of additional children",
  );
  expect(await submissions(request)).toHaveLength(0);
  await count.fill("2");
  await expect(
    page.getByText("3 people expected at each selected session."),
  ).toBeVisible();
});

for (const width of [320, 375, 412, 1280]) {
  test(`conflict reload and deadline notices at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(request, {
      rsvp: accepted,
      deadline: "2031-11-08T16:59:59Z",
    });
    await open(page);
    await editSaved(page);
    const dietary = page.locator(".public-rsvp-form").getByRole("textbox");
    await expectPass(page, null);
    const send = page.getByRole("button", {
      name: /^(Submit RSVP|Save Changes)$/,
    });
    const alert = page.locator(".rsvp-information-section").getByRole("alert");
    await dietary.fill("My unsaved changes");
    await configure(request, {
      rsvp: { ...accepted, version: 23, dietaryNotes: "Saved elsewhere" },
      checkinPass: {
        status: "ACTIVE",
        issuedAt: "2026-09-30T00:00:00Z",
        qrPayload: secondPass,
      },
    });
    await send.click();
    await expect(alert).toContainText("has been updated since you opened");
    await expect(alert).toBeFocused();
    await expect(dietary).toHaveValue("My unsaved changes");
    await expect(send).toBeDisabled();
    await expectPass(page, null);
    await noticeScreenshot(page, info, `conflict-${width}`);
    await dietary.fill("Keep this draft until I reload");
    await expect(send).toBeDisabled();
    await page
      .getByRole("form", { name: "Your RSVP" })
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    expect(await submissions(request)).toHaveLength(1);

    // A failed GET must retain both the draft and the conflict lock.
    await configure(request, {
      failure: { status: 503, code: "UNEXPECTED", method: "GET" },
    });
    const reload = page.getByRole("button", { name: "Reload latest RSVP" });
    await reload.focus();
    await page.keyboard.press("Enter");
    await expect(alert).toContainText("details couldn’t be loaded");
    await expect(alert).toBeFocused();
    await expect(dietary).toHaveValue("Keep this draft until I reload");
    await expectPass(page, null);
    await expect(send).toBeDisabled();
    expect(await submissions(request)).toHaveLength(1);

    await configure(request, {});
    await reload.click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("latest RSVP has been loaded");
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toBeFocused();
    await editSaved(page);
    await expect(dietary).toHaveValue("Saved elsewhere");
    await expectPass(page, null);
    expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
      false,
    );
    await expect(send).toBeEnabled();
    expect((await (await request.get(`${MOCK}/__count`)).json()).count).toBe(1);
    await dietary.fill("My reviewed response");
    await send.click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("acceptance has been saved");
    expect((await submissions(request))[1]!.expectedVersion).toBe(23);

    await editSaved(page);
    const beforeDeadline = await request.get(`${MOCK}/__rsvp-state`);
    const { reads } = await beforeDeadline.json();
    await configure(request, {
      failure: { status: 422, code: "RSVP_DEADLINE_PASSED", method: "PATCH" },
    });
    await send.click();
    await expect(alert).toContainText("RSVP is closed");
    await expect(alert).toBeFocused();
    await expect(
      page.getByText("Kindly reply by 8 November 2031 at 23:59 WIB."),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(dietary).toBeDisabled();
    await expectPass(page, null);
    await expect(dietary).toHaveValue("My reviewed response");
    await expect(
      page.getByRole("button", { name: /Try again|Reload latest RSVP/ }),
    ).toHaveCount(0);
    await noticeScreenshot(page, info, `deadline-${width}`);
    await page
      .getByRole("form", { name: "Your RSVP" })
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    expect(await submissions(request)).toHaveLength(3);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectPass(page, secondPass);
    await expect(page.getByRole("button", { name: "Edit RSVP" })).toHaveCount(
      0,
    );
    await expect(alert).toContainText("RSVP is closed");
    const shortcut = heroAction(page, "View Check-in QR");
    await expect(shortcut).toHaveAttribute("href", "#checkin-pass-title");
    await shortcut.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Your check-in pass" }),
    ).toBeFocused();
    const afterShortcut = await request.get(`${MOCK}/__rsvp-state`);
    expect(await afterShortcut.json()).toMatchObject({ reads: reads + 1 });
    expect(await submissions(request)).toHaveLength(3);
    await expect(page.getByText("See you at the Wedding!")).toBeAttached();
  });
}

for (const outcome of ["revoked", "replaced", "read failed"] as const) {
  test(`deadline rejection never restores an old QR when revalidation shows ${outcome}`, async ({
    page,
    request,
  }) => {
    await configure(request, { rsvp: accepted });
    await open(page);
    await expectPass(page, firstPass);
    await editSaved(page);
    const before = await request.get(`${MOCK}/__rsvp-state`);
    const { reads } = await before.json();
    await configure(request, {
      failure: { status: 422, code: "RSVP_DEADLINE_PASSED", method: "PATCH" },
      ...(outcome === "revoked" && { checkinPass: null }),
      ...(outcome === "replaced" && {
        checkinPass: {
          status: "ACTIVE",
          issuedAt: "2026-09-30T00:00:00Z",
          qrPayload: secondPass,
        },
      }),
      ...(outcome === "read failed" && {
        readFailure: { status: 503, code: "UNEXPECTED" },
      }),
    });
    await page
      .getByRole("button", { name: "Save Changes", exact: true })
      .click();
    const alert = page.locator(".rsvp-information-section").getByRole("alert");
    await expect(alert).toContainText("RSVP is closed");
    await expectPass(page, null);
    await expect(heroAction(page, "View Check-in QR")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(alert).toContainText("RSVP is closed");
    await expect(page.getByRole("button", { name: "Edit RSVP" })).toHaveCount(
      0,
    );
    await expectPass(page, outcome === "replaced" ? secondPass : null);
    await expect(
      heroAction(
        page,
        outcome === "replaced" ? "View Check-in QR" : "View RSVP",
      ),
    ).toBeVisible();
    const after = await request.get(`${MOCK}/__rsvp-state`);
    expect(await after.json()).toMatchObject({ reads: reads + 1 });
    expect(await submissions(request)).toHaveLength(1);
  });
}

test("temporary server failure suspends the QR and requires reload before an explicit new edit", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: accepted,
    failure: { status: 500, code: "INTERNAL_SERVER_ERROR", method: "PATCH" },
  });
  await open(page);
  await editSaved(page);
  await page
    .getByLabel("Dietary requirements (optional)")
    .fill("Reviewed dietary notes");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("alert"),
  ).toContainText("could not confirm whether");
  await expectPass(page, null);
  await expect(
    page.getByRole("button", { name: "Save Changes", exact: true }),
  ).toBeDisabled();
  expect(await submissions(request)).toHaveLength(1);
  await configure(request, {});
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expectPass(page, firstPass);
  await editSaved(page);
  await page
    .getByLabel("Dietary requirements (optional)")
    .fill("Reviewed dietary notes");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Attendance Confirmed", exact: true }),
  ).toBeVisible();
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([7, 7]);
});

test("a lost save response recovers the committed result through GET without another mutation", async ({
  page,
  request,
}) => {
  await configure(request, { rsvp: accepted, dropResponse: true });
  await open(page);
  await editSaved(page);
  await page
    .getByLabel("Dietary requirements (optional)")
    .fill("Saved but response lost");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("alert"),
  ).toContainText("could not confirm whether");
  await expectPass(page, null);
  await expect(
    page.getByRole("button", { name: "Save Changes", exact: true }),
  ).toBeDisabled();
  await configure(request, {});
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expect(
    page.getByRole("heading", { name: "Attendance Confirmed", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".public-rsvp-form")).toContainText(
    "Saved but response lost",
  );
  await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
  await expectPass(page, firstPass);
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([7]);
});

test("initial read retry loads existing state without re-opening the invitation", async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await configure(request, {
    failure: { status: 503, code: "UNEXPECTED", method: "GET" },
  });
  await open(page);
  await expect(heroAction(page, "View RSVP")).toBeVisible();
  await heroAction(page, "View RSVP").click();
  await expect(page.locator("#rsvp-title")).toBeFocused();
  await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
  await expectPass(page, null);
  const reload = page.getByRole("button", { name: "Reload latest RSVP" });
  await expect(reload).toBeEnabled();
  await expect(heroAction(page, "View RSVP")).toBeVisible();
  await noticeScreenshot(page, info, "initial-load-failure");
  await reload.click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("details couldn’t be loaded");
  await expect(page.locator(".public-rsvp-form")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(reload).toBeEnabled();
  await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
  expect(await submissions(request)).toHaveLength(0);
  await configure(request, { rsvp: { ...accepted, version: 19 } });
  await reload.click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toBeFocused();
  await expect(heroAction(page, "View Check-in QR")).toBeVisible();
  await editSaved(page);
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  await expectPass(page, null);
  await page.getByRole("radio", { name: "Regretfully Decline" }).check();
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("saved as not attending");
  expect((await submissions(request))[0]!.expectedVersion).toBe(19);
  expect((await (await request.get(`${MOCK}/__count`)).json()).count).toBe(1);
});

for (const [code, button, group] of [
  ["EVENT_NOT_SELECTED", "Review events", "Which sessions will you attend?"],
  ["PLUS_ONE_NOT_ALLOWED", "Review attendees", "Who will attend with you?"],
] as const) {
  test(`${code} guides correction without blind retry`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width: 412, height: 900 });
    await configure(request, {
      rsvp: accepted,
      failure: { status: 422, code, method: "PATCH" },
    });
    await open(page);
    await editSaved(page);
    await page
      .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
      .click();
    const alert = page.locator(".rsvp-information-section").getByRole("alert");
    await expect(alert).toContainText("Please review your response");
    await expect(alert).toBeFocused();
    await expect(
      page.getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ }),
    ).toBeDisabled();
    await noticeScreenshot(page, info, code.toLowerCase());
    await page.getByRole("button", { name: button }).click();
    await expect(
      page.getByRole("group", { name: group, exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("group", { name: group, exact: true }),
    ).toHaveAttribute("aria-describedby", /error/);
    await configure(request, {});
    if (code === "PLUS_ONE_NOT_ALLOWED")
      await page
        .getByRole("radio", { name: "I’ll attend on my own", exact: true })
        .check();
    else
      await page
        .getByRole("radio", { name: "Reception Test", exact: true })
        .check();
    await page
      .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
      .click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("acceptance has been saved");
    expect(
      (await submissions(request)).map((body) => body.expectedVersion),
    ).toEqual([7, 7]);
  });
}

test("unavailable mutation locks the form without disclosing a reason", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: accepted,
    failure: { status: 404, code: "INVITATION_NOT_AVAILABLE", method: "PATCH" },
  });
  await open(page);
  await editSaved(page);
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  const alert = page.locator(".rsvp-information-section").getByRole("alert");
  await expect(alert).toContainText("This invitation is no longer available.");
  await expect(alert).not.toContainText(
    /archived|expired|credential|token|hash|INVITATION_NOT_AVAILABLE/,
  );
  await expect(
    page.getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ }),
  ).toBeDisabled();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  await expectPass(page, null);
  expect(await submissions(request)).toHaveLength(1);
});

test("pending state disables submission and prevents duplicate requests", async ({
  page,
  request,
}) => {
  await configure(request, { delayMs: 1000 });
  await open(page);
  await accept(page);
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("radio", { name: "Joyfully Accept" }),
  ).toBeDisabled();
  await page.getByRole("form", { name: "Your RSVP" }).evaluate((element) => {
    element.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("Your acceptance has been saved.");
  expect(await submissions(request)).toHaveLength(1);
});

for (const status of ["ACCEPTED", "DECLINED"] as const) {
  test(`hero RSVP link opens the saved ${status} view without submitting`, async ({
    page,
    request,
  }) => {
    await configure(request, {
      rsvp:
        status === "ACCEPTED"
          ? accepted
          : { ...accepted, status, partyMode: undefined },
    });
    await open(page);
    const confirmation = page.getByRole("region", {
      name: "Your RSVP confirmation",
    });
    await expect(confirmation).toBeVisible();
    const stateBefore = await request.get(`${MOCK}/__rsvp-state`);
    const { reads } = await stateBefore.json();
    const action = heroAction(
      page,
      status === "ACCEPTED" ? "View Check-in QR" : "View RSVP Response",
    );
    const target =
      status === "ACCEPTED" ? "checkin-pass-title" : "rsvp-response-title";
    await expect(action).toHaveAttribute("href", `#${target}`);
    const heading = page.getByRole("heading", {
      name: status === "ACCEPTED" ? "Your check-in pass" : "Unable to Attend",
    });
    if (status === "ACCEPTED") {
      await action.focus();
      await page.keyboard.press("Enter");
      await expectPass(page, firstPass);
    } else {
      await action.click();
      await expectPass(page, null);
    }
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(heading).toHaveCSS("outline-style", "solid");
    expect(new URL(page.url()).hash).toBe("");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(
      status === "ACCEPTED" ? "Attendance Confirmed" : "Unable to Attend",
    );
    await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
    const stateAfter = await request.get(`${MOCK}/__rsvp-state`);
    expect(await stateAfter.json()).toMatchObject({ reads, requests: [] });
  });
}

test("hero RSVP link drops stale QR after failed revalidation and pass revocation", async ({
  page,
  request,
}) => {
  await configure(request, { rsvp: accepted });
  await open(page);
  await expect(heroAction(page, "View Check-in QR")).toBeVisible();
  await configure(request, {
    failure: { status: 503, code: "UNEXPECTED", method: "GET" },
  });
  await page.getByRole("button", { name: "Edit RSVP" }).click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("details couldn’t be loaded");
  await expect(heroAction(page, "View RSVP")).toBeVisible();
  await expectPass(page, null);

  await configure(request, {
    checkinPass: null,
    editBlockedReason: "CHECKED_IN",
  });
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "has checked in" }),
  ).toBeVisible();
  await expect(heroAction(page, "View RSVP")).toHaveAttribute(
    "href",
    "#rsvp-title",
  );
  await expect(heroAction(page, "View Check-in QR")).toHaveCount(0);
  await expectPass(page, null);
  await expect(page.getByRole("button", { name: "Edit RSVP" })).toHaveCount(0);
  expect(await submissions(request)).toHaveLength(0);
});

test.describe("QR shortcut on a narrow touch viewport", () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });
  test("hero RSVP link jumps straight to the existing pass with reduced motion", async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await configure(request, { rsvp: accepted });
    await open(page);
    const action = heroAction(page, "View Check-in QR");
    await expect(action).toBeInViewport({ ratio: 1 });
    await action.tap();
    const heading = page.getByRole("heading", { name: "Your check-in pass" });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(heading).toHaveCSS("outline-style", "solid");
    await expectPass(page, firstPass);
  });
});

test("loads accepted state and keeps its draft on a version conflict", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: accepted,
    failure: { status: 409, code: "RSVP_VERSION_CONFLICT", method: "PATCH" },
  });
  await open(page);
  await editSaved(page);
  await expect(
    page.getByRole("radio", { name: "Joyfully Accept" }),
  ).toBeChecked();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  await expect(
    page.getByRole("radio", { name: "Holy Matrimony Test", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "I’ll bring a plus one", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("has been updated since you opened");
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  expect((await submissions(request))[0]!.expectedVersion).toBe(7);
  await expect(
    page.getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ }),
  ).toBeDisabled();
});

test("declined initial state hides stale values and respects companion permissions", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: { ...accepted, status: "DECLINED", partyMode: undefined },
    rules: { allowPlusOne: false, maxAdditionalChildren: 0 },
  });
  await open(page);
  await editSaved(page);
  await expect(
    page.getByRole("radio", { name: "Regretfully Decline" }),
  ).toBeChecked();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await page
    .getByRole("radio", { name: "Holy Matrimony Test", exact: true })
    .check();
  await expect(
    page.getByRole("radio", { name: "I’ll bring a plus one", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: "I’ll attend on my own", exact: true }),
  ).not.toBeChecked();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveCount(0);
});

test("initial GET failure never enables a create-only form", async ({
  page,
  request,
}) => {
  await configure(request, {
    failure: { status: 404, code: "INVITATION_NOT_AVAILABLE", method: "GET" },
  });
  await open(page);
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("This invitation is no longer available.");
  await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
  expect(await submissions(request)).toHaveLength(0);
});

test("attendance and event choices are keyboard operable with visible focus", async ({
  page,
}) => {
  await open(page);
  const choice = page.getByRole("radio", { name: "Joyfully Accept" });
  await choice.focus();
  await page.keyboard.press("Space");
  await expect(choice).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "Regretfully Decline" }),
  ).toBeChecked();
  await expect(choice).not.toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Tab");
  const event = page.getByRole("radio", {
    name: "Holy Matrimony Test",
    exact: true,
  });
  await expect(event).toBeFocused();
  await page.keyboard.press("Space");
  await expect(event).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "I’ll attend on my own", exact: true }),
  ).toBeVisible();
  expect(
    await event.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
});

test("conflict reload adopts a saved decline and removes the previous pass", async ({
  page,
  request,
}) => {
  await configure(request, { rsvp: accepted });
  await open(page);
  await editSaved(page);
  await expectPass(page, null);
  await page.locator(".public-rsvp-form").getByRole("textbox").fill("My draft");
  await configure(request, {
    rsvp: {
      ...accepted,
      partyMode: undefined,
      status: "DECLINED",
      version: 8,
      dietaryNotes: null,
      attendees: [],
      eventSelections: [],
      attendeeQuantityTotal: 0,
    },
  });
  await page
    .getByRole("button", { name: /^(Submit RSVP|Save Changes)$/ })
    .click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("My draft");
  await expectPass(page, null);
  await expect(heroAction(page, "View RSVP")).toBeVisible();
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expect(
    page.getByRole("heading", { name: "Unable to Attend", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("latest RSVP has been loaded");
  await expectPass(page, null);
  await expect(heroAction(page, "View RSVP Response")).toBeVisible();
  expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
    false,
  );
});

test("an uncertain first acceptance never invents a pass before explicit recovery", async ({
  page,
  request,
}) => {
  await configure(request, { dropResponse: true });
  await open(page);
  await accept(page);
  await page.getByRole("button", { name: "Submit RSVP", exact: true }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("alert"),
  ).toContainText("could not confirm whether");
  await expectPass(page, null);
  await expect(heroAction(page, "View RSVP")).toBeVisible();
  await configure(request, {});
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expectPass(page, firstPass);
  await expect(heroAction(page, "View Check-in QR")).toBeVisible();
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([null]);
});

for (const width of [320, 375, 412]) {
  test(`saved RSVP opens read-only and Cancel performs no mutation at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await configure(request, { rsvp: accepted });
    await open(page);
    await expect(
      page.getByRole("heading", { name: "Attendance Confirmed", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
    await editSaved(page);
    await page
      .getByLabel("Dietary requirements (optional)")
      .fill("Unsaved draft");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
    await expect(page.locator(".public-rsvp-form")).toContainText("No seafood");
    await expect(page.locator(".public-rsvp-form")).not.toContainText(
      "Unsaved draft",
    );
    expect(await submissions(request)).toHaveLength(0);
    await open(page);
    await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const reason of ["DEADLINE_PASSED", "CHECKED_IN"] as const) {
  test(`saved confirmation respects server editing restriction ${reason}`, async ({
    page,
    request,
  }) => {
    await configure(request, { rsvp: accepted, editBlockedReason: reason });
    await open(page);
    await expect(
      page.getByRole("heading", { name: "Attendance Confirmed", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit RSVP", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
    await expectPass(page, firstPass);
    await expect(heroAction(page, "View Check-in QR")).toBeVisible();
    expect(await submissions(request)).toHaveLength(0);
  });
}

function stickyAction(page: Page) {
  return page.locator(".invitation-sticky-rsvp").getByRole("link");
}

async function browsePastHero(page: Page) {
  await page
    .locator("#couple-title")
    .evaluate((heading) =>
      heading.scrollIntoView({ block: "start", behavior: "instant" }),
    );
}

async function expectStickyAction(page: Page, label: string, target: string) {
  const action = stickyAction(page);
  const hero = heroAction(page, label);
  await expect(action).toHaveAccessibleName(label);
  await expect(action).toHaveAttribute("href", `#${target}`);
  await expect(hero).toHaveAttribute("href", `#${target}`);
  await expect(action).toBeInViewport({ ratio: 1 });
  return action;
}

async function expectRsvpTraffic(
  request: APIRequestContext,
  reads: number,
  mutations = 0,
) {
  const response = await request.get(`${MOCK}/__rsvp-state`);
  const state = await response.json();
  expect(state.reads).toBe(reads);
  expect(state.requests).toHaveLength(mutations);
}

for (const width of [320, 375, 412]) {
  test(`sticky RSVP shortcut clears the form and fits a ${width}px viewport`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(PATH);
    await expect(page.locator(".invitation-sticky-rsvp")).toHaveCount(0);
    await page.getByRole("button", { name: "Open invitation" }).click();
    const hero = heroAction(page, "Confirm Attendance");
    await expect(hero).toBeVisible();
    await expect(stickyAction(page)).toBeHidden();

    await hero.focus();
    await browsePastHero(page);
    const action = await expectStickyAction(
      page,
      "Confirm Attendance",
      "rsvp-title",
    );
    const box = (await action.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(640);
    await page.keyboard.press("Tab");
    await expect(action).toBeFocused();
    await expect(action).toHaveCSS("outline-style", "solid");

    // Scrolling back across the threshold must not drop keyboard focus.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".invitation-sticky-rsvp")).not.toHaveAttribute(
      "data-visible",
      "true",
    );
    await expect(action).toBeFocused();
    await page.keyboard.press("Enter");
    const heading = page.locator("#rsvp-title");
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(stickyAction(page)).toBeHidden();

    await page.getByRole("radio", { name: "Regretfully Decline" }).check();
    const submit = page.getByRole("button", { name: "Submit RSVP" });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(stickyAction(page)).toBeHidden();
    await expect(heroAction(page, "Confirm Attendance")).toBeVisible();
    await expectRsvpTraffic(request, 1);

    await submit.click();
    await expect(heroAction(page, "View RSVP Response")).toBeVisible();
    await browsePastHero(page);
    await expectStickyAction(page, "View RSVP Response", "rsvp-response-title");
    await expectRsvpTraffic(request, 1, 1);
  });
}

test("sticky RSVP shortcut responds to viewport changes, zoom and the message form", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  await open(page);
  await browsePastHero(page);
  await expectStickyAction(page, "Confirm Attendance", "rsvp-title");

  for (const size of [
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await browsePastHero(page);
    await expect(stickyAction(page)).toBeHidden();
    await expect(heroAction(page, "Confirm Attendance")).toBeVisible();
  }

  await page.setViewportSize({ width: 375, height: 640 });
  await browsePastHero(page);
  await expectStickyAction(page, "Confirm Attendance", "rsvp-title");

  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await expect(stickyAction(page)).toBeHidden();
  await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await expectStickyAction(page, "Confirm Attendance", "rsvp-title");

  const message = page.getByRole("textbox", { name: /Your message/ });
  await message.focus();
  await expect(message).toBeFocused();
  await expect(stickyAction(page)).toBeHidden();
  await message.fill("Synthetic message draft.");
  await expect(message).toHaveValue("Synthetic message draft.");
  await browsePastHero(page);
  await expect(message).toBeFocused();
  await expect(stickyAction(page)).toBeHidden();
  await message.blur();
  await expectStickyAction(page, "Confirm Attendance", "rsvp-title");
  await expectRsvpTraffic(request, 1);
});

for (const status of ["ACCEPTED", "DECLINED"] as const) {
  test(`sticky RSVP shortcut opens the saved ${status} view without requests`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 660 });
    await configure(request, {
      rsvp:
        status === "ACCEPTED"
          ? accepted
          : { ...accepted, status, partyMode: undefined },
    });
    await open(page);
    await browsePastHero(page);
    const hasPass = status === "ACCEPTED";
    const target = hasPass ? "checkin-pass-title" : "rsvp-response-title";
    const action = await expectStickyAction(
      page,
      hasPass ? "View Check-in QR" : "View RSVP Response",
      target,
    );
    await action.click();
    await expect(page.locator(`#${target}`)).toBeFocused();
    await expect(page.locator(`#${target}`)).toBeInViewport({ ratio: 1 });
    await expect(stickyAction(page)).toBeHidden();
    await expectPass(page, hasPass ? firstPass : null);
    await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
    await expectRsvpTraffic(request, 1);
  });
}

test("sticky RSVP shortcut hides stale QR after failed recovery and revocation", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  await configure(request, { rsvp: accepted });
  await open(page);
  await browsePastHero(page);
  await expectStickyAction(page, "View Check-in QR", "checkin-pass-title");

  await configure(request, {
    failure: { status: 503, code: "UNEXPECTED", method: "GET" },
  });
  await page.getByRole("button", { name: "Edit RSVP" }).click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("details couldn’t be loaded");
  await browsePastHero(page);
  const fallback = await expectStickyAction(page, "View RSVP", "rsvp-title");
  await fallback.click();
  await expect(page.locator("#rsvp-title")).toBeFocused();
  await expectPass(page, null);
  await expectRsvpTraffic(request, 2);

  await configure(request, {
    checkinPass: null,
    editBlockedReason: "CHECKED_IN",
  });
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "has checked in" }),
  ).toBeVisible();
  await browsePastHero(page);
  await expectStickyAction(page, "View RSVP", "rsvp-title");
  await expectPass(page, null);
  await expectRsvpTraffic(request, 3);
});

test("sticky RSVP shortcut disconnects when observing a section fails", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PATH);
  const openInvitation = page.getByRole("button", { name: "Open invitation" });
  await expect(openInvitation).toBeEnabled();

  await page.evaluate(() => {
    const BrowserObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends BrowserObserver {
      private sticky = false;

      override observe(target: Element) {
        if (this.sticky) throw new Error("Synthetic sticky observe failure");
        this.sticky = target.matches(".invitation-hero");
        super.observe(target);
      }

      override disconnect() {
        if (this.sticky)
          Reflect.set(window, "stickyObserverDisconnected", true);
        super.disconnect();
      }
    };
  });

  await openInvitation.press("Enter");
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "stickyObserverDisconnected")),
    )
    .toBe(true);
  await browsePastHero(page);
  await expect(stickyAction(page)).toBeHidden();

  await heroAction(page, "Confirm Attendance").press("Enter");
  await expect(page.locator("#rsvp-title")).toBeFocused();
  await expect(page.getByRole("form", { name: "Your RSVP" })).toBeVisible();
  await expectRsvpTraffic(request, 1);
});
