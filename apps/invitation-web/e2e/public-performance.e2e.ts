import { MOCK_API_ORIGIN } from "./harness";
import { expect, test } from "@playwright/test";
test.use({ screenshot: "off", trace: "off" });
test("records a credential-free local rendering baseline", async ({
  page,
  request,
}, info) => {
  test.skip(
    info.config.metadata.performanceMode !== "built-local",
    "Measure the optimized build through next start.",
  );
  await request.post(`${MOCK_API_ORIGIN}/__reset`);
  await page.addInitScript(() => {
    const measurements = { lcpMs: 0, cls: 0, longTasks: 0 };
    Reflect.set(window, "renderMeasurements", measurements);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        measurements.lcpMs = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput: boolean;
          value: number;
        };
        if (!shift.hadRecentInput) measurements.cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      measurements.longTasks += list.getEntries().length;
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(`/i/${"A".repeat(43)}`);
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole("button", { name: "Open invitation" }),
  ).toBeVisible();
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const metrics = await page.evaluate(() => ({
    ...(Reflect.get(window, "renderMeasurements") as {
      lcpMs: number;
      cls: number;
      longTasks: number;
    }),
    scriptTransferBytes: performance
      .getEntriesByType("resource")
      .filter(
        (entry) =>
          (entry as PerformanceResourceTiming).initiatorType === "script",
      )
      .reduce(
        (sum, entry) => sum + (entry as PerformanceResourceTiming).transferSize,
        0,
      ),
  }));
  await info.attach("local-rendering-baseline", {
    body: JSON.stringify(metrics),
    contentType: "application/json",
  });
  process.stdout.write(`LOCAL_RENDER_METRICS ${JSON.stringify(metrics)}\n`);
  // Local optimized-build baseline: 156 ms LCP, zero CLS, 147233 script bytes.
  // These allow CI headroom; they are not mobile/production service guarantees.
  expect(metrics.lcpMs).toBeGreaterThan(0);
  expect(metrics.lcpMs).toBeLessThan(2000);
  expect(metrics.cls).toBeLessThan(0.05);
  expect(metrics.scriptTransferBytes).toBeLessThan(200_000);
});
