import { MOCK_API_ORIGIN } from "./harness";
import { expect, test } from "@playwright/test";

const guestUrl = `/i/${"V".repeat(43)}`;
test("venue content on the guest route follows publish state and exact event eligibility", async ({
  page,
}, testInfo) => {
  await page.goto(guestUrl);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await page.getByRole("button", { name: "View invitation" }).click();
  if (testInfo.config.metadata.venuePublished === true) {
    await expect(
      page.getByRole("region", { name: "Parking Guide", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Event Rundown", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("11.30 WIB", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Published reception parking", { exact: true }),
    ).toBeVisible();
    expect(await page.content()).not.toContain("RESTRICTED_CEREMONY_CONTENT");
    for (const width of [360, 390, 412]) {
      await page.setViewportSize({ width, height: 800 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  } else {
    await expect(
      page.getByRole("region", { name: "Parking Guide", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Event Rundown", exact: true }),
    ).toHaveCount(0);
    expect(await page.content()).not.toContain("[CONTOH]");
  }
});

test("development preview is explicit, synthetic and cannot grant an event", async ({
  page,
  request,
}, testInfo) => {
  if (testInfo.config.metadata.performanceMode === "built-local") {
    expect((await request.get("/dev/venue-preview")).status()).toBe(404);
    expect((await request.get("/dev/venue-preview?event=none")).status()).toBe(
      404,
    );
    return;
  }
  const before = await (await request.get(`${MOCK_API_ORIGIN}/__count`)).json();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/venue-preview");
  await expect(
    page.getByRole("heading", { name: "Draft venue preview" }),
  ).toBeVisible();
  await expect(page.getByText("11.30 WIB", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.locator('meta[name="robots"]').getAttribute("content"),
  ).toContain("noindex");
  if (!testInfo.config.metadata.venuePublished)
    await page.screenshot({
      path: "test-results/venue-preview-390.png",
      fullPage: true,
    });
  await page
    .getByRole("link", { name: "No eligible event", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Parking Guide", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Event Rundown", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(
    "No venue content for the selected event.",
  );
  expect(
    await (await request.get(`${MOCK_API_ORIGIN}/__count`)).json(),
  ).toEqual(before);
});
