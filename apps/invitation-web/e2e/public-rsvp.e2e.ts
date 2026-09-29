import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import type { SubmitPublicRsvpRequest } from "../../../packages/api-client/src/index";

const MOCK = "http://127.0.0.1:4010";
const PATH = `/i/${"A".repeat(43)}`;
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

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__reset`)).status()).toBe(204);
});

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
    const form = page.getByRole("form", { name: "Your RSVP" });
    await expect(form.locator("input:checked")).toHaveCount(0);
    await accept(page);
    await page.getByRole("checkbox", { name: "Bring a plus one" }).check();
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
    await expect(page.getByRole("status")).toHaveText(
      "Your response has been saved.",
    );
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
    await page
      .getByRole("checkbox", { name: "Reception Test", exact: true })
      .uncheck();
    await dietary.fill("");
    await page.getByRole("button", { name: "Send RSVP" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Your response has been saved.",
    );
    const update = (await submissions(request))[1]!;
    expect(update.expectedVersion).toBe(42);
    expect(update.dietaryNotes).toBeNull();
    expect(update.eventSelections[1]).toEqual({
      eventId: "event-test-2",
      attending: false,
      expectedAttendeeCount: 0,
    });
    expect(update).not.toHaveProperty("guestNote");

    // Re-read dedicated RSVP state on a new invitation load.
    await open(page);
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
    await expect(page.getByRole("status")).toHaveText(
      "Your response has been saved.",
    );
    expect((await submissions(request))[2]).toEqual({
      expectedVersion: 43,
      status: "DECLINED",
      attendees: [],
      eventSelections: [],
      dietaryNotes: null,
    });
    await page.getByRole("radio", { name: "Joyfully Accept" }).check();
    await expect(page.getByText("Total attending: 0")).toBeVisible();
    await expect(dietary).toHaveValue("");
    expect(errors).toEqual([]);
    await expect(
      page.locator(
        ".guest-message-section input, .guest-message-section textarea",
      ),
    ).toHaveCount(0);
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
  ).toHaveText("Please choose whether you can join us.");
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toBeFocused();
  await expect(page.getByRole("form")).toHaveAttribute(
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
  await page.getByRole("checkbox", { name: "Bring a plus one" }).check();
  await expect(count).toHaveValue("2");
  await page.getByRole("checkbox", { name: "Bring a plus one" }).uncheck();
  await expect(count).toHaveValue("1");
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
  await page.getByRole("form").evaluate((element) => {
    element.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByRole("status")).toHaveText(
    "Your response has been saved.",
  );
  expect(await submissions(request)).toHaveLength(1);
});

test("loads accepted state and keeps its draft on a generic API failure", async ({
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
  await expect(page.getByRole("textbox")).toHaveValue("No seafood");
  await expect(
    page.getByRole("spinbutton", {
      name: "Guests attending Holy Matrimony Test",
    }),
  ).toHaveValue("2");
  await page.getByRole("button", { name: "Send RSVP" }).click();
  await expect(
    page.locator(".rsvp-information-section").getByRole("alert"),
  ).toContainText("couldn’t save");
  await expect(page.getByRole("textbox")).toHaveValue("No seafood");
  expect((await submissions(request))[0]!.expectedVersion).toBe(7);
  await expect(page.getByRole("button", { name: "Send RSVP" })).toBeEnabled();
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
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await page.getByRole("radio", { name: "Joyfully Accept" }).check();
  await expect(
    page.getByRole("checkbox", { name: "Bring a plus one" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("spinbutton", { name: /Additional children/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveValue("");
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
  ).toContainText("couldn’t load");
  await expect(page.getByRole("form")).toHaveCount(0);
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
