import { MOCK_API_ORIGIN } from "./harness";
import { expect, test } from "@playwright/test";
test.use({ screenshot: "off", trace: "off" });
test.beforeEach(async ({ page, request }) => {
  await request.post(`${MOCK_API_ORIGIN}/__reset`);
  await page.goto(`/i/${"A".repeat(43)}`);
  await page.getByRole("button", { name: "Buka Undangan" }).click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
});
test("calendar downloads the eligible event instant without invitation or QR credentials", async ({
  page,
}) => {
  const event = page
      .locator(".event-card")
      .filter({ hasText: "Holy Matrimony Test" }),
    downloadEvent = page.waitForEvent("download");
  await event.getByRole("button", { name: "Tambahkan ke Kalender" }).click();
  const download = await downloadEvent,
    stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream!) content += String(chunk);
  expect(content).toContain("DTSTART:20270109T010000Z");
  expect(content).toContain("Test Church");
  expect(content.includes("A".repeat(43))).toBe(false);
  expect(content.includes("qrPayload")).toBe(false);
  expect(content.includes("URL:")).toBe(false);
  await expect(page.getByText("Parking guide deferred")).toHaveCount(0);
});

test("countdown seconds visibly advance while the page stays open", async ({
  page,
}) => {
  const seconds = page.locator('[data-countdown-unit="seconds"]');
  await expect(seconds).toBeVisible();
  await page.clock.install();
  const before = await seconds.textContent();
  await page.clock.fastForward(3000);
  await expect(seconds).not.toHaveText(before!);
  await expect(page.locator(".countdown-part")).toHaveCount(4);
});
test("gallery contains keyboard focus, navigates photos and restores its trigger on Escape", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "Lihat foto pranikah 1",
    exact: true,
  });
  await trigger.click();
  const modal = page.getByRole("dialog", { name: "Penampil foto pranikah" });
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Tutup galeri foto" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    modal.getByRole("button", { name: "Foto Berikutnya" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(modal.getByText("Foto 2 dari 4", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
for (const width of [360, 390, 412])
  test(`enhancements fit ${width}px and reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(
      page.getByRole("region", {
        name: "Hitung mundur menuju Holy Matrimony Test",
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Lihat foto pranikah 4",
        exact: true,
      })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Penampil foto pranikah",
    });
    const box = await modal.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
