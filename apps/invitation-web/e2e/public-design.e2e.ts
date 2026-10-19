import { MOCK_API_ORIGIN } from "./harness";
import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

// Only the existing synthetic mock credential; no live invitation data or QR snapshots.
test.use({ screenshot: "off", trace: "off" });
const fixturePath = `/i/${"A".repeat(43)}`;
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK_API_ORIGIN}/__reset`)).status()).toBe(204);
});

test("opening ignores repeated activation and transfers keyboard focus without retrieving again", async ({
  page,
  request,
}) => {
  await page.goto(fixturePath);
  const open = page.getByRole("button", { name: "Open invitation" });
  await open.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  const view = page.getByRole("button", { name: "View invitation" });
  await expect(view).toBeVisible();
  await expect(view).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeVisible();
  expect(
    (await (await request.get(`${MOCK_API_ORIGIN}/__count`)).json()).count,
  ).toBe(1);
});

test("changing reduced motion during envelope transition immediately reaches the opened cover", async ({
  page,
}) => {
  await page.goto(fixturePath);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("button", { name: "View invitation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View invitation" }).click();
  await page.locator(".couple-profile").first().scrollIntoViewIfNeeded();
  expect(
    await page
      .locator(".couple-profile")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
});

test("paper folds reveal the cover beneath while its action stays inert until opening finishes", async ({
  page,
  request,
}, info) => {
  // Reproduce the owner's browser preference, then explicitly opt into motion.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 412, height: 917 });
  await page.goto(fixturePath);
  const envelope = await page
    .locator(".invitation-envelope-button")
    .boundingBox();
  expect(envelope!.x).toBe(0);
  expect(envelope!.y).toBe(0);
  expect(envelope!.height).toBe(917);
  expect(envelope!.width).toBe(412);
  await page.getByRole("button", { name: "Enable animations" }).click();
  await expect(
    page.getByRole("button", { name: "Enable animations" }),
  ).toHaveAttribute("aria-pressed", "true");
  const underlay = page.locator(".invitation-cover-underlay");
  await expect(underlay).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", { name: "View invitation" }),
  ).toHaveCount(0);
  await underlay.locator("img").evaluate(async (node) => {
    await (node as HTMLImageElement).decode();
  });
  await page.getByRole("button", { name: "Open invitation" }).click();
  await expect
    .poll(() =>
      page.locator(".invitation-envelope-layer-front").evaluate((node) => {
        const transform = new DOMMatrixReadOnly(
          getComputedStyle(node).transform,
        );
        return transform.m11 < 0.95 && Math.abs(transform.m13) > 0.1;
      }),
    )
    .toBe(true);
  await expect(underlay).toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", { name: "Open invitation" }),
  ).toBeDisabled();
  await page.screenshot({
    path: path.resolve(
      info.config.rootDir,
      "../../../docs/design/jo-venta/review/runtime-envelope-opening-412.png",
    ),
  });
  const view = page.getByRole("button", { name: "View invitation" });
  await expect(view).toBeVisible();
  await expect(view).toBeFocused();
  await expect(underlay).not.toHaveAttribute("inert", "");
  expect(
    (await (await request.get(`${MOCK_API_ORIGIN}/__count`)).json()).count,
  ).toBe(1);
  await view.click();
  await expect(
    page.locator(".invitation-opening-content[data-entering=true]"),
  ).toBeAttached();
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  await expect(page.locator("[data-entering=true]")).toHaveCount(0);
  await expect(page.locator(".couple-profile").first()).toHaveClass(
    /invitation-revealed/,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable animations" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("clean hero image failure retains the unmodified flattened fallback and one semantic title", async ({
  page,
}) => {
  await page.route("**/_next/image?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams
        .get("url")
        ?.startsWith("/assets/photography/cover-")
    )
      await route.abort();
    else await route.continue();
  });
  await page.goto(fixturePath);
  await page.getByRole("button", { name: "Open invitation" }).click();
  const cover = page.getByRole("button", { name: "View invitation" });
  await expect(cover).toHaveClass(/invitation-opened-cover-fallback/);
  await expect(cover.locator("img")).toHaveAttribute("src", /opened-hero/);
  await expect(page.locator("#invitation-opened-title")).toHaveClass(
    "visually-hidden",
  );
  await cover.click();
  await expect(page.getByRole("heading", { name: "Test Guest" })).toBeVisible();
});

test("responsive layout fills the viewport and keeps labels clear of photos", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 360, 390, 412, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixturePath, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open invitation" }).click();
    await page.getByRole("button", { name: "View invitation" }).click();
    await page.evaluate(() => document.fonts.ready);
    const frame = await page
      .locator(".public-invitation-surface")
      .boundingBox();
    expect(frame!.width).toBeGreaterThanOrEqual(width - 20);
    expect(frame!.width).toBeLessThanOrEqual(width);
    expect(frame!.x).toBe(0);
    await expect(page.locator(".invitation-identity")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    for (const role of ["bride", "groom"] as const) {
      const profile = page.locator(`.couple-profile-${role}`);
      const photo = await profile.locator(".couple-media-slot").boundingBox();
      const copy = await profile.locator(".couple-copy").boundingBox();
      const title = await profile.locator(".couple-role").boundingBox();
      const name = await profile.locator("h3").boundingBox();
      // Script labels must remain in the text column, clear of photos/names.
      expect(
        role === "bride"
          ? title!.x >= photo!.x + photo!.width
          : title!.x + title!.width <= photo!.x,
      ).toBe(true);
      expect(title!.y + title!.height).toBeLessThanOrEqual(name!.y);
      expect(role === "bride" ? photo!.x < copy!.x : photo!.x > copy!.x).toBe(
        true,
      );
      expect(Math.abs(photo!.y - copy!.y)).toBeLessThan(photo!.height);
      expect(
        await profile
          .locator("h3")
          .evaluate((node) => getComputedStyle(node).fontSize),
      ).toBe(width <= 360 ? "12px" : width >= 700 ? "18px" : "14px");
      expect(
        await profile
          .locator(".couple-role")
          .evaluate((node) => getComputedStyle(node).fontSize),
      ).toBe(width <= 360 ? "30px" : width >= 700 ? "42px" : "36px");
    }
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const clipped = await page
    .locator(
      ".couple-copy h3, .couple-family-names, .event-card h3, .wedding-date-section h2, .public-rsvp-form legend:not(.visually-hidden)",
    )
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => ({
          tag: node.tagName,
          className: node.className,
          width: node.clientWidth,
          scrollWidth: node.scrollWidth,
        })),
    );
  expect(clipped).toEqual([]);
  await expect(page.locator(".public-rsvp-form")).toBeVisible();
});

test("missing reveal observer leaves invitation text, forms and gallery usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.set(window, "IntersectionObserver", undefined);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixturePath);
  await page.getByRole("button", { name: "Open invitation" }).click();
  await page.getByRole("button", { name: "View invitation" }).click();
  await expect(page.locator(".couple-profile").first()).toBeVisible();
  await expect(page.locator(".public-rsvp-form")).toBeVisible();
  await page
    .getByRole("button", { name: "View pre-wedding photograph 2" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Pre-wedding photo viewer" }),
  ).toBeVisible();
  await expect(page.locator(".gallery-dialog-image img")).toHaveAttribute(
    "src",
    /pic-03-/,
  );
});

test("records owner-photo geometry and synthetic visual evidence through the opened journey", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const directory = path.resolve(
    info.config.rootDir,
    "../../../docs/design/jo-venta/review",
  );
  await fs.mkdir(directory, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const evidence = [];
  for (const width of [390, 412, 1440]) {
    await page.setViewportSize({
      width,
      height: width === 1440 ? 900 : width === 412 ? 917 : 844,
    });
    await page.goto(fixturePath);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(directory, `runtime-envelope-${width}.png`),
    });
    await page.evaluate(() => performance.mark("design-open-start"));
    await page.getByRole("button", { name: "Open invitation" }).click();
    await page
      .locator(".invitation-opened-media img")
      .evaluate(async (node) => {
        await (node as HTMLImageElement).decode();
      });
    await expect(page.locator(".invitation-opened-cover-fallback")).toHaveCount(
      0,
    );
    const heroReadyMs = await page.evaluate(
      () =>
        performance.now() -
        performance.getEntriesByName("design-open-start")[0]!.startTime,
    );
    await page.screenshot({
      path: path.join(directory, `runtime-opened-${width}.png`),
    });
    await page.getByRole("button", { name: "View invitation" }).click();
    // This fixture has no saved RSVP/pass. Never capture a real or active QR.
    await expect(page.locator(".guest-checkin-pass")).toHaveCount(0);
    for (const selector of [
      ".couple-section",
      ".events-section",
      ".gallery-section",
      ".invitation-footer",
    ])
      await page.locator(selector).scrollIntoViewIfNeeded();
    // Full-document screenshots include offscreen lazy images. Request them for
    // capture only; otherwise decode() can wait forever for an unrequested src.
    await page
      .locator(".public-invitation-surface img")
      .evaluateAll((nodes) => {
        nodes.forEach((node) => {
          (node as HTMLImageElement).loading = "eager";
        });
      });
    // Exercise and decode each selected responsive candidate before capture.
    // HTTP completion alone does not mean a PNG is decoded for painting.
    for (const [index, image] of (
      await page.locator(".public-invitation-surface img").all()
    ).entries()) {
      await image.evaluate((node) => {
        const frame =
          node.closest(
            ".couple-media-slot,.gallery-frame,.invitation-decoration,.figma-header-rule,.figma-dress-palette",
          ) ?? node;
        frame.scrollIntoView({ block: "center", inline: "nearest" });
      });
      await image.evaluate(async (node) => {
        const image = node as HTMLImageElement;
        await Promise.race([
          image.decode(),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`Image decode timed out: ${image.currentSrc}`),
                ),
              10_000,
            ),
          ),
        ]);
      });
      await expect
        .poll(
          () =>
            image.evaluate((node) => {
              const element = node as HTMLImageElement;
              return element.complete && element.naturalWidth > 0;
            }),
          { message: `Image ${index} must finish loading in the viewport` },
        )
        .toBe(true);
    }
    await expect
      .poll(
        async () =>
          page.locator(".public-invitation-surface img").evaluateAll((nodes) =>
            nodes.flatMap((node, index) => {
              const image = node as HTMLImageElement;
              return image.complete && image.naturalWidth > 0
                ? []
                : [
                    {
                      index,
                      complete: image.complete,
                      naturalWidth: image.naturalWidth,
                    },
                  ];
            }),
          ),
        { timeout: 8000 },
      )
      .toEqual([]);
    const images = await page
      .locator(".public-invitation-surface img")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const image = node as HTMLImageElement;
          const rect = image.getBoundingClientRect();
          return {
            naturalWidth: image.naturalWidth,
            width: rect.width,
            height: rect.height,
            fit: getComputedStyle(image).objectFit,
            position: getComputedStyle(image).objectPosition,
          };
        }),
      );
    expect(
      await page
        .locator(".public-invitation-surface")
        .evaluate((node) => node.scrollLeft),
    ).toBe(0);
    expect(
      await page
        .locator(".gallery-section")
        .evaluate((node) => node.scrollLeft),
    ).toBe(0);
    expect(
      images.every(
        (image) =>
          image.naturalWidth > 0 && image.width > 0 && image.height > 0,
      ),
    ).toBe(true);
    await page.locator(".couple-section").screenshot({
      path: path.join(directory, `runtime-couple-${width}.png`),
    });
    await page.locator(".gallery-section").screenshot({
      path: path.join(directory, `runtime-gallery-${width}.png`),
    });
    await page.locator(".public-invitation-surface").screenshot({
      path: path.join(directory, `runtime-content-${width}.png`),
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(directory, `runtime-layout-${width}.png`),
    });
    evidence.push({ width, heroReadyMs, images });
  }
  await fs.writeFile(
    path.join(directory, "runtime-visual-verification.json"),
    JSON.stringify(
      {
        date: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Jakarta",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        mode: info.config.metadata.performanceMode ?? "development",
        scope:
          "Synthetic mock household only; no active pass; owner photos and preserved decorations",
        evidence,
        limitations: [
          "Chromium desktop emulation only",
          "Hero readiness measures the test-driver journey including interaction overhead; not LCP or field INP",
          "Final content approval and physical devices remain pending",
        ],
      },
      null,
      2,
    ) + "\n",
  );
});
