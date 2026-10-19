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
  await page.getByRole("button", { name: "View invitation" }).click();
}

async function accept(page: Page) {
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await page.getByRole("checkbox", { name: "Test Guest", exact: true }).check();
  await page
    .getByRole("checkbox", { name: "Holy Matrimony Test", exact: true })
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
    await expectPass(page, null);
    const form = page.getByRole("form", { name: "Your RSVP" });
    await expect(form.locator("input:checked")).toHaveCount(0);
    await accept(page);
    await page
      .getByRole("checkbox", {
        name: "Of Course I will bring my Wife/Husband or plus one!",
      })
      .check();
    await page
      .getByRole("spinbutton", { name: /Additional children/ })
      .fill("2");
    await page
      .getByRole("checkbox", { name: "Reception Test", exact: true })
      .check();
    await page
      .getByRole("spinbutton", { name: "Guests attending Holy Matrimony Test" })
      .fill("4");
    await page
      .getByRole("spinbutton", { name: "Guests attending Reception Test" })
      .fill("2");
    const dietary = page.getByRole("textbox", {
      name: "Dietary requirements (optional)",
    });
    await dietary.fill("No seafood");
    await expect(page.getByText("Total attending: 4")).toBeVisible();
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
    await page.getByRole("button", { name: "Send RSVP" }).click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Your acceptance has been saved.");
    expect((await submissions(request))[0]).toEqual({
      expectedVersion: null,
      status: "ACCEPTED",
      attendees: [
        { type: "NAMED_INVITEE", inviteeId: "invitee-test-1", quantity: 1 },
        { type: "PLUS_ONE", inviteeId: null, quantity: 1 },
        { type: "ADDITIONAL_CHILD", inviteeId: null, quantity: 2 },
      ],
      eventSelections: [
        { eventId: "event-test-1", attending: true, expectedAttendeeCount: 4 },
        { eventId: "event-test-2", attending: true, expectedAttendeeCount: 2 },
      ],
      dietaryNotes: "No seafood",
    });
    await expect(dietary).toHaveValue("No seafood");
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("before the reply deadline");
    await noticeScreenshot(page, testInfo, `accepted-${width}`);
    await expectPass(page, firstPass);
    await assertPassLayout(page);
    const originalModules = await page
      .locator(".guest-checkin-pass svg")
      .innerHTML();
    await page
      .getByRole("checkbox", { name: "Reception Test", exact: true })
      .uncheck();
    await dietary.fill("");
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).not.toContainText("saved");
    await page.getByRole("button", { name: "Send RSVP" }).click();
    await expect(
      page.locator(".public-rsvp-form").getByRole("status"),
    ).toContainText("Your acceptance has been saved.");
    const update = (await submissions(request))[1]!;
    expect(update.expectedVersion).toBe(42);
    expect(update.dietaryNotes).toBeNull();
    expect(update.eventSelections[1]).toEqual({
      eventId: "event-test-2",
      attending: false,
      expectedAttendeeCount: 0,
    });
    expect(update).not.toHaveProperty("guestNote");
    await expectPass(page, firstPass);
    expect(
      (await page.locator(".guest-checkin-pass svg").innerHTML()) ===
        originalModules,
    ).toBe(true);

    // Re-read dedicated RSVP state on a new invitation load.
    await open(page);
    await expectPass(page, firstPass);
    await expect(
      page.getByRole("radio", { name: "Joyfully Accept" }),
    ).toBeChecked();
    await expect(
      page.getByRole("spinbutton", {
        name: "Guests attending Holy Matrimony Test",
      }),
    ).toHaveValue("4");
    await page.getByRole("radio", { name: "Regretfully Decline" }).check();
    await expect(dietary).toHaveCount(0);
    await page.getByRole("radio", { name: "Joyfully Accept" }).check();
    await expect(
      page.getByRole("spinbutton", { name: /Additional children/ }),
    ).toHaveValue("2");
    await page.getByRole("radio", { name: "Regretfully Decline" }).check();
    await page.getByRole("button", { name: "Send RSVP" }).click();
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
    expect((await page.locator("body").innerText()).includes(firstPass)).toBe(
      false,
    );
    await page.getByRole("radio", { name: "Joyfully Accept" }).check();
    await expect(page.getByText("Total attending: 0")).toBeVisible();
    await expect(dietary).toHaveValue("");
    await accept(page);
    await page.getByRole("button", { name: "Send RSVP" }).click();
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

test("validates required choice, people, events and counts; normalizes composition reductions", async ({
  page,
  request,
}) => {
  await open(page);
  const send = page.getByRole("button", { name: "Send RSVP" });
  await send.click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("Please choose whether you can join us.");
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toBeFocused();
  await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveAttribute(
    "aria-describedby",
    /error/,
  );
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await send.click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("at least one person");
  await page.getByRole("checkbox", { name: "Test Guest", exact: true }).check();
  await send.click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("at least one event");
  await page
    .getByRole("checkbox", { name: "Holy Matrimony Test", exact: true })
    .check();
  const count = page.getByRole("spinbutton", {
    name: "Guests attending Holy Matrimony Test",
  });
  await expect(count).toBeEnabled();
  await count.fill("2");
  await send.click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("event count");
  expect(await submissions(request)).toHaveLength(0);
  await page
    .getByRole("checkbox", {
      name: "Of Course I will bring my Wife/Husband or plus one!",
    })
    .check();
  await expect(count).toHaveValue("2");
  await page
    .getByRole("checkbox", {
      name: "Of Course I will bring my Wife/Husband or plus one!",
    })
    .uncheck();
  await expect(count).toHaveValue("1");
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
    const dietary = page.locator(".public-rsvp-form").getByRole("textbox");
    await expectPass(page, firstPass);
    const send = page.getByRole("button", { name: "Send RSVP" });
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
    await expect(dietary).toHaveValue("Saved elsewhere");
    await expectPass(page, secondPass);
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

    await configure(request, {
      failure: { status: 422, code: "RSVP_DEADLINE_PASSED", method: "PUT" },
    });
    await send.click();
    await expect(alert).toContainText("RSVP is closed");
    await expect(alert).toBeFocused();
    await expect(
      page.getByText("Kindly reply by 8 November 2031."),
    ).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(dietary).toBeDisabled();
    await expectPass(page, secondPass);
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
    await expect(page.getByText("See you at the Wedding!")).toBeAttached();
  });
}

test("temporary server failure keeps the version and draft for an explicit retry", async ({
  page,
  request,
}, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await configure(request, {
    rsvp: accepted,
    failure: { status: 500, code: "INTERNAL_SERVER_ERROR", method: "PUT" },
  });
  await open(page);
  await page
    .locator(".public-rsvp-form")
    .getByRole("textbox")
    .fill("Keep my dietary notes");
  await page.getByRole("button", { name: "Send RSVP" }).click();
  const alert = page.locator(".rsvp-information-section").getByRole("alert");
  await expect(alert).toContainText("Your changes are still here");
  await expect(alert).toBeFocused();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("Keep my dietary notes");
  await expectPass(page, firstPass);
  expect(await submissions(request)).toHaveLength(1);
  await noticeScreenshot(page, info, "temporary-failure");
  await configure(request, {});
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("acceptance has been saved");
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([7, 7]);
});

test("a lost save response retries the original version and recovers from conflict", async ({
  page,
  request,
}) => {
  await configure(request, { rsvp: accepted, dropResponse: true });
  await open(page);
  await page
    .locator(".public-rsvp-form")
    .getByRole("textbox")
    .fill("Saved but response lost");
  await page.getByRole("button", { name: "Send RSVP" }).click();
  const alert = page.locator(".rsvp-information-section").getByRole("alert");
  await expect(alert).toContainText("Something went wrong while saving");
  await expectPass(page, firstPass);
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("Saved but response lost");
  expect(await submissions(request)).toHaveLength(1);
  await configure(request, {});
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(alert).toContainText("has been updated since you opened");
  await expectPass(page, null);
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([7, 7]);
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("latest RSVP has been loaded");
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("Saved but response lost");
  await expectPass(page, firstPass);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("acceptance has been saved");
  expect((await submissions(request))[2]!.expectedVersion).toBe(8);
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
  await expect(page.getByRole("form", { name: "Your RSVP" })).toHaveCount(0);
  await expectPass(page, null);
  const reload = page.getByRole("button", { name: "Reload latest RSVP" });
  await expect(reload).toBeEnabled();
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
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toBeFocused();
  await expectPass(page, firstPass);
  await page.getByRole("radio", { name: "Regretfully Decline" }).check();
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("saved as not attending");
  expect((await submissions(request))[0]!.expectedVersion).toBe(19);
  expect((await (await request.get(`${MOCK}/__count`)).json()).count).toBe(1);
});

for (const [code, button, group] of [
  ["EVENT_NOT_SELECTED", "Review events", "Which events will you attend?"],
  ["PLUS_ONE_NOT_ALLOWED", "Review attendees", "Who will be joining us?"],
] as const) {
  test(`${code} guides correction without blind retry`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width: 412, height: 900 });
    await configure(request, {
      rsvp: accepted,
      failure: { status: 422, code, method: "PUT" },
    });
    await open(page);
    await page.getByRole("button", { name: "Send RSVP" }).click();
    const alert = page.locator(".rsvp-information-section").getByRole("alert");
    await expect(alert).toContainText("Please review your response");
    await expect(alert).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Send RSVP" }),
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
        .getByRole("checkbox", {
          name: "Of Course I will bring my Wife/Husband or plus one!",
        })
        .uncheck();
    else
      await page
        .getByRole("checkbox", { name: "Reception Test", exact: true })
        .check();
    await page.getByRole("button", { name: "Send RSVP" }).click();
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
    failure: { status: 404, code: "INVITATION_NOT_AVAILABLE", method: "PUT" },
  });
  await open(page);
  await page.getByRole("button", { name: "Send RSVP" }).click();
  const alert = page.locator(".rsvp-information-section").getByRole("alert");
  await expect(alert).toContainText("This invitation is no longer available.");
  await expect(alert).not.toContainText(
    /archived|expired|credential|token|hash|INVITATION_NOT_AVAILABLE/,
  );
  await expect(page.getByRole("button", { name: "Send RSVP" })).toBeDisabled();
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
  await page.getByRole("button", { name: "Send RSVP" }).click();
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

test("loads accepted state and keeps its draft on a version conflict", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: accepted,
    failure: { status: 409, code: "RSVP_VERSION_CONFLICT", method: "PUT" },
  });
  await open(page);
  await expect(
    page.getByRole("radio", { name: "Joyfully Accept" }),
  ).toBeChecked();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  await expect(
    page.getByRole("spinbutton", {
      name: "Guests attending Holy Matrimony Test",
    }),
  ).toHaveValue("2");
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("has been updated since you opened");
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("No seafood");
  expect((await submissions(request))[0]!.expectedVersion).toBe(7);
  await expect(page.getByRole("button", { name: "Send RSVP" })).toBeDisabled();
});

test("declined initial state hides stale values and respects companion permissions", async ({
  page,
  request,
}) => {
  await configure(request, {
    rsvp: { ...accepted, status: "DECLINED" },
    rules: { allowPlusOne: false, maxAdditionalChildren: 0 },
  });
  await open(page);
  await expect(
    page.getByRole("radio", { name: "Regretfully Decline" }),
  ).toBeChecked();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await expect(
    page.getByRole("checkbox", {
      name: "Of Course I will bring my Wife/Husband or plus one!",
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("spinbutton", { name: /Additional children/ }),
  ).toHaveCount(0);
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("");
  await expect(
    page.getByRole("checkbox", { name: "Test Guest", exact: true }),
  ).not.toBeChecked();
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
  await expect(
    page.getByRole("checkbox", { name: "Attend all invited events" }),
  ).toBeFocused();
  const guest = page.getByRole("checkbox", { name: "Test Guest", exact: true });
  await guest.focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("checkbox", { name: "Test Guest", exact: true }),
  ).toBeChecked();
  const event = page.getByRole("checkbox", {
    name: "Holy Matrimony Test",
    exact: true,
  });
  await event.focus();
  await page.keyboard.press("Space");
  await expect(event).toBeChecked();
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
  await expectPass(page, firstPass);
  await page.locator(".public-rsvp-form").getByRole("textbox").fill("My draft");
  await configure(request, {
    rsvp: {
      ...accepted,
      status: "DECLINED",
      version: 8,
      dietaryNotes: null,
      attendees: [],
      eventSelections: [],
      attendeeQuantityTotal: 0,
    },
  });
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(
    page.locator(".public-rsvp-form").getByRole("textbox"),
  ).toHaveValue("My draft");
  await expectPass(page, null);
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expect(
    page.getByRole("radio", { name: "Regretfully Decline" }),
  ).toBeChecked();
  await expect(
    page.locator(".public-rsvp-form").getByRole("status"),
  ).toContainText("latest RSVP has been loaded");
  await expectPass(page, null);
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
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("Something went wrong while saving");
  await expectPass(page, null);
  await configure(request, {});
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("has been updated since you opened");
  await expectPass(page, null);
  await page.getByRole("button", { name: "Reload latest RSVP" }).click();
  await expectPass(page, firstPass);
  expect(
    (await submissions(request)).map((body) => body.expectedVersion),
  ).toEqual([null, null]);
});
