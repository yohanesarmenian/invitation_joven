import { MOCK_API_ORIGIN } from "./harness";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

// Test-only credentials. Kept as local literals (not imported from the mock) so
// importing this file never starts the mock's HTTP listener inside a worker.
const TEST_PUBLIC_CREDENTIAL = "A".repeat(43);
const TEST_UNAVAILABLE_CREDENTIAL = "B".repeat(43);
const TEST_MALFORMED_CREDENTIAL = "C".repeat(43);

const MOCK_API_BASE_URL = MOCK_API_ORIGIN;

const SUCCESS_PATH = `/i/${TEST_PUBLIC_CREDENTIAL}`;
const UNAVAILABLE_PATH = `/i/${TEST_UNAVAILABLE_CREDENTIAL}`;
const MALFORMED_PATH = `/i/${TEST_MALFORMED_CREDENTIAL}`;

// Current owner contract: full-viewport canvas, centered readable sections.
// See docs/UI-UX-SPEC.md, Responsive Strategy, and FIGMA-FIDELITY.md.
const CONTENT_MAX_WIDTHS = [
  [".invitation-header", 900],
  [".couple-section", 1040],
  [".wedding-date-section", 800],
  [".events-section", 1040],
  [".dress-code-section", 640],
  [".rsvp-information-section", 780],
  [".guest-message-section", 720],
  [".event-countdown", 620],
  [".gallery-mosaic", 1200],
  [".quote-section", 900],
] as const;
// Sub-pixel / rounding tolerance. Geometry is asserted loosely on purpose.
const TOLERANCE = 2;

const VIEWPORTS = [
  { width: 320, height: 800 },
  { width: 375, height: 800 },
  { width: 412, height: 800 },
  { width: 480, height: 800 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
];

// Representative visible elements, including the overflow-clipped surface and
// the closing section. `.public-invitation-surface` sets `overflow-x: hidden`,
// so document scrollWidth alone would not catch inner clipping.
const REPRESENTATIVE_SELECTORS = [
  ".public-invitation-page",
  ".public-invitation-surface",
  ".event-card",
  ".map-link",
  ".invitation-footer",
];

async function resetMockRequestCount(
  request: APIRequestContext,
): Promise<void> {
  const response = await request.post(`${MOCK_API_BASE_URL}/__reset`);
  expect(response.status()).toBe(204);
}

async function readMockRequestCount(
  request: APIRequestContext,
): Promise<number> {
  const response = await request.get(`${MOCK_API_BASE_URL}/__count`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { count: number }).count;
}

async function advanceToContent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open invitation" }).click();
  await page.getByRole("button", { name: "View invitation" }).click();
  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeVisible();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
}

test.beforeEach(async ({ request }) => {
  await resetMockRequestCount(request);
});

for (const viewport of VIEWPORTS) {
  test(`stays within the ${viewport.width}px viewport with no horizontal overflow`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(SUCCESS_PATH);
    await advanceToContent(page);

    const documentOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));

    expect(documentOverflow.scrollWidth).toBeLessThanOrEqual(
      documentOverflow.innerWidth + 1,
    );

    for (const selector of REPRESENTATIVE_SELECTORS) {
      const elements = page.locator(selector);
      const count = await elements.count();
      expect(count, `${selector} should be present`).toBeGreaterThan(0);

      for (let index = 0; index < count; index += 1) {
        const box = await elements.nth(index).boundingBox();
        expect(box, `${selector}[${index}] should have a box`).not.toBeNull();
        expect(
          box!.x,
          `${selector}[${index}] starts left of the viewport`,
        ).toBeGreaterThanOrEqual(-TOLERANCE);
        expect(
          box!.x + box!.width,
          `${selector}[${index}] extends past the viewport`,
        ).toBeLessThanOrEqual(viewport.width + TOLERANCE);
      }
    }

    for (const selector of [
      ".invitation-opening-flow",
      ".public-invitation-surface",
    ]) {
      const frameBox = await page.locator(selector).boundingBox();
      expect(frameBox, `${selector} should have a box`).not.toBeNull();
      expect(
        Math.abs(frameBox!.width - viewport.width),
        `${selector} should fill the viewport`,
      ).toBeLessThanOrEqual(TOLERANCE);
      expect(
        Math.abs(frameBox!.x + frameBox!.width / 2 - viewport.width / 2),
        `${selector} should stay horizontally centered`,
      ).toBeLessThanOrEqual(TOLERANCE);
    }

    if (viewport.width >= 700) {
      for (const [selector, maxWidth] of CONTENT_MAX_WIDTHS) {
        const section = page.locator(selector);
        await expect(section).toHaveCount(1);
        const box = await section.boundingBox();
        expect(box, `${selector} should have a box`).not.toBeNull();
        expect(
          box!.width,
          `${selector} should retain its readable width`,
        ).toBeLessThanOrEqual(Math.min(viewport.width, maxWidth) + TOLERANCE);
        expect(
          Math.abs(box!.x + box!.width / 2 - viewport.width / 2),
          `${selector} should stay horizontally centered`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    }

    // Synthetic guest data with the current reviewed presentation assets.
    await page.screenshot({
      path: testInfo.outputPath(`invitation-${viewport.width}.png`),
      fullPage: true,
    });
  });
}

test("opening controls are real buttons and the keyboard alone completes the flow", async ({
  page,
}) => {
  await page.goto(SUCCESS_PATH);

  const openButton = page.getByRole("button", { name: "Open invitation" });
  const viewButton = page.getByRole("button", { name: "View invitation" });
  const content = page.locator(".invitation-opening-content");

  await expect(openButton).toBeVisible();
  expect(await openButton.evaluate((element) => element.tagName)).toBe(
    "BUTTON",
  );

  let reachedOpenButton = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.keyboard.press("Tab");

    if (
      await openButton.evaluate((element) => element === document.activeElement)
    ) {
      reachedOpenButton = true;
      break;
    }
  }
  expect(reachedOpenButton, "Tab should reach the Open invitation button").toBe(
    true,
  );

  await page.keyboard.press("Enter");

  await expect(viewButton).toBeVisible();
  expect(await viewButton.evaluate((element) => element.tagName)).toBe(
    "BUTTON",
  );
  await expect
    .poll(() =>
      viewButton.evaluate((element) => element === document.activeElement),
    )
    .toBe(true);

  await page.keyboard.press("Space");

  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeVisible();
  await expect
    .poll(() =>
      content.evaluate((element) => element === document.activeElement),
    )
    .toBe(true);
});

test("reduced motion keeps every opening stage functional", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(SUCCESS_PATH);

  await page.getByRole("button", { name: "Open invitation" }).click();
  await expect(
    page.getByRole("button", { name: "View invitation" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "View invitation" }).click();
  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeVisible();
  await expect(page.getByText("Test Church")).toBeVisible();
  await expect(page.getByText("Test Ballroom")).toBeVisible();
});

test("unavailable invitation renders the generic not-found UI without leaking details", async ({
  page,
  request,
}) => {
  const navigation = await page.goto(UNAVAILABLE_PATH);

  await expect(
    page.getByRole("heading", { name: "Invitation unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("We could not load this invitation."),
  ).toBeVisible();

  expect(navigation?.status()).toBe(404);
  expect(await readMockRequestCount(request)).toBe(1);

  const visibleText = await page.locator("body").innerText();
  for (const secret of [
    TEST_UNAVAILABLE_CREDENTIAL,
    "INVITATION_NOT_AVAILABLE",
    "archived",
    "expired",
    "Test Household",
    "Holy Matrimony Test",
    "Reception Test",
    "Test Church",
    "Test Ballroom",
  ]) {
    expect(visibleText).not.toContain(secret);
  }
});

test("malformed 200 reaches the error boundary and never becomes not-found", async ({
  page,
  request,
}) => {
  await page.goto(MALFORMED_PATH);

  await expect(
    page.getByRole("heading", { name: "Unable to load the invitation" }),
  ).toBeVisible();
  await expect(page.getByText("Please try again in a moment.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Invitation unavailable" }),
  ).toBeHidden();

  expect(await readMockRequestCount(request)).toBe(1);

  const visibleText = await page.locator("body").innerText();
  for (const secret of [
    TEST_MALFORMED_CREDENTIAL,
    "not-an-array",
    "INVITATION_NOT_AVAILABLE",
    "Test Household",
    "Test Church",
  ]) {
    expect(visibleText).not.toContain(secret);
  }
});
