import { MOCK_API_ORIGIN } from "./harness";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const MOCK_API_BASE_URL = MOCK_API_ORIGIN;

// Test-only credential, must match mock-public-invitation-api.ts.
const TEST_PUBLIC_CREDENTIAL = "A".repeat(43);
const TEST_INVITATION_PATH = `/i/${TEST_PUBLIC_CREDENTIAL}`;

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

function eventCard(page: Page, eventName: string) {
  return page.locator(".event-card").filter({ hasText: eventName });
}

test.beforeEach(async ({ request }) => {
  await resetMockRequestCount(request);
});

test("closed to opened to content retrieves the invitation exactly once", async ({
  page,
  request,
}) => {
  await page.goto(TEST_INVITATION_PATH);

  // Closed state: only the envelope is rendered, no invitation content yet.
  const openButton = page.getByRole("button", { name: "Open invitation" });
  await expect(openButton).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeHidden();
  expect(await readMockRequestCount(request)).toBe(1);

  await openButton.click();

  // Opened state: still no new server render, so still one retrieval.
  const viewButton = page.getByRole("button", { name: "View invitation" });
  await expect(viewButton).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeHidden();
  expect(await readMockRequestCount(request)).toBe(1);

  await viewButton.click();

  // Content state: API-driven data from the single server-side retrieval.
  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Holy Matrimony Test" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reception Test" }),
  ).toBeVisible();
  await expect(page.getByText("08.00")).toBeVisible();
  await expect(page.getByText("12.00")).toBeVisible();
  await expect(page.getByText("Test Church")).toBeVisible();
  await expect(page.getByText("Test Ballroom")).toBeVisible();
  await expect(page.getByText("1 Test Street")).toBeVisible();
  await expect(page.getByText("2 Test Avenue")).toBeVisible();
  expect(await readMockRequestCount(request)).toBe(1);
});

test("event map links point at the fixture URLs with safe target and rel", async ({
  page,
}) => {
  await page.goto(TEST_INVITATION_PATH);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await page.getByRole("button", { name: "View invitation" }).click();

  const churchLink = eventCard(page, "Holy Matrimony Test").getByRole("link", {
    name: "View in Google Maps",
  });
  await expect(churchLink).toHaveAttribute(
    "href",
    "https://maps.example.test/church",
  );
  await expect(churchLink).toHaveAttribute("target", "_blank");
  await expect(churchLink).toHaveAttribute("rel", /noopener/);
  await expect(churchLink).toHaveAttribute("rel", /noreferrer/);

  const receptionLink = eventCard(page, "Reception Test").getByRole("link", {
    name: "View in Google Maps",
  });
  await expect(receptionLink).toHaveAttribute(
    "href",
    "https://maps.example.test/reception",
  );
  await expect(receptionLink).toHaveAttribute("target", "_blank");
  await expect(receptionLink).toHaveAttribute("rel", /noopener/);
  await expect(receptionLink).toHaveAttribute("rel", /noreferrer/);
});

test("reload resets to closed state and triggers one new server retrieval", async ({
  page,
  request,
}) => {
  await page.goto(TEST_INVITATION_PATH);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await page.getByRole("button", { name: "View invitation" }).click();
  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeVisible();
  expect(await readMockRequestCount(request)).toBe(1);

  await page.reload();

  // A reload is a new server render: the flow restarts closed and the mock is
  // hit once more. One retrieval per server render is the real invariant.
  await expect(
    page.getByRole("button", { name: "Open invitation" }),
  ).toBeVisible();
  expect(await readMockRequestCount(request)).toBe(2);
});
