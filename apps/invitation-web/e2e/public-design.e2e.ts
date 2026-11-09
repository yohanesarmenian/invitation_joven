import { MOCK_API_ORIGIN } from "./harness";
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { invitationMotion } from "../src/presentation/invitation-motion";

// Synthetic local credential only. No live bearer URL or active pass is captured.
test.use({ screenshot: "off", trace: "off" });
const fixturePath = `/i/${"A".repeat(43)}`;

test.beforeEach(async ({ request }) => {
  expect((await request.post(MOCK_API_ORIGIN + "/__reset")).status()).toBe(204);
});

async function expectContent(page: Page) {
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await expect(page.locator(".invitation-opening-content")).not.toHaveAttribute(
    "inert",
  );
  await expect(
    page.getByRole("heading", { name: "Test Guest", exact: true }),
  ).toBeVisible();
}

for (const width of [375, 1280]) {
  test(`wedding monograms use Yohanes and Angelina initials at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(fixturePath);
    const open = page.getByRole("button", {
      name: "Open invitation",
      exact: true,
    });
    await expect(open).toBeEnabled();
    await expect(page.locator(".invitation-envelope-wax")).toHaveText("Y&A");
    await expect(page.locator(".invitation-envelope-hint")).toHaveCSS(
      "opacity",
      "1",
    );
    await page.screenshot({
      path: info.outputPath(`monogram-envelope-${width}.png`),
    });
    await open.click();
    await expectContent(page);
    await expect(page.locator(".invitation-hero-monogram")).toHaveText("Y&A");
    await expect(page.locator(".invitation-hero-title")).toHaveText(
      "Jo & Venta",
    );
    await page.locator(".invitation-hero").screenshot({
      path: info.outputPath(`monogram-hero-${width}.png`),
    });

    await page.route("**/_next/image?**", (route) => {
      const asset =
        new URL(route.request().url()).searchParams.get("url") ?? "";
      return asset.startsWith("/assets/photography/cover-")
        ? route.abort()
        : route.continue();
    });
    await page.reload();
    await expect(open).toBeEnabled();
    await open.click();
    await expectContent(page);
    await expect(page.locator(".invitation-hero")).toHaveAttribute(
      "data-fallback",
      "true",
    );
    await expect(page.locator(".invitation-hero-monogram")).toHaveText("Y&A");
    await expect(page.locator(".invitation-hero-paper-monogram")).toHaveText(
      "Y&A",
    );
    await expect(page.locator(".invitation-hero-title")).toHaveText(
      "Jo & Venta",
    );
    await page.locator(".invitation-hero").screenshot({
      path: info.outputPath(`monogram-fallback-${width}.png`),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("authorized content is already mounted and inaccessible behind the prepared envelope", async ({
  page,
  request,
}) => {
  let writes = 0;
  const imageRequests: string[] = [];
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
    const url = new URL(request.url());
    if (url.origin !== "http://localhost:3000")
      externalRequests.push(url.origin);
    if (url.pathname === "/_next/image")
      imageRequests.push(url.searchParams.get("url") ?? "");
  });
  await page.goto(fixturePath);
  const content = page.locator(".invitation-opening-content");
  await expect(content).toHaveAttribute("inert", "");
  await expect(content).toHaveAttribute("aria-hidden", "true");
  await expect(content.locator(".public-rsvp-form")).toBeAttached();
  await expect(
    page.getByRole("heading", { name: "Test Guest", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View invitation", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open invitation", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    document
      .querySelector<HTMLInputElement>(".public-rsvp-form input")
      ?.focus(),
  );
  expect(
    await content.evaluate((node) => node.contains(document.activeElement)),
  ).toBe(false);
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press("Tab");
    expect(
      await content.evaluate((node) => node.contains(document.activeElement)),
    ).toBe(false);
  }
  expect(
    (await (await request.get(MOCK_API_ORIGIN + "/__count")).json()).count,
  ).toBe(1);
  expect(writes).toBe(0);
  expect(externalRequests).toEqual([]);
  expect(imageRequests.some((source) => /\/pic-0[123]-/.test(source))).toBe(
    false,
  );
  // Frame geometry exists before opening, while image sources remain deferred.
  await expect(page.locator(".gallery-frame")).toHaveCount(4);
  await expect(page.locator(".gallery-frame img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expectContent(page);
  await expect(page.locator(".gallery-frame img")).toHaveCount(4);
  // Images then retain normal lazy loading below the prepared initial hero.
  expect(
    await page
      .locator(".gallery-frame img")
      .evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).loading === "lazy"),
      ),
  ).toBe(true);
});

test("one Enter activation rejects repeats and transfers focus directly to content", async ({
  page,
  request,
}) => {
  await page.goto(fixturePath);
  const open = page.getByRole("button", {
    name: "Open invitation",
    exact: true,
  });
  await expect(open).toBeEnabled();
  await open.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expectContent(page);
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "View invitation", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await request.get(MOCK_API_ORIGIN + "/__count")).json()).count,
  ).toBe(1);
});

test("paper folds reveal the prepared hero while forms stay inert", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 412, height: 900 });
  await page.goto(fixturePath);
  const open = page.getByRole("button", {
    name: "Open invitation",
    exact: true,
  });
  await expect(open).toBeEnabled();
  await open.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  const content = page.locator(".invitation-opening-content");
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "opening",
  );
  await expect(content).toHaveAttribute("inert", "");
  await expect(open).toBeDisabled();
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
  await page.screenshot({
    path: info.outputPath("native-envelope-opening-412.png"),
  });
  await expectContent(page);
  await expect(content).toBeFocused();
});

test("missing transition-end events finish through the bounded completion fallback", async ({
  page,
}) => {
  await page.addInitScript(() =>
    document.addEventListener(
      "transitionend",
      (event) => event.stopImmediatePropagation(),
      true,
    ),
  );
  await page.goto(fixturePath);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expectContent(page);
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
});

test("changing reduced motion while opening immediately completes the same activation", async ({
  page,
}) => {
  await page.goto(fixturePath);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectContent(page);
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
});

test("reduced motion supports one Space activation with no opening delay", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixturePath);
  const open = page.getByRole("button", {
    name: "Open invitation",
    exact: true,
  });
  await expect(open).toBeEnabled();
  await open.focus();
  await page.keyboard.press("Space");
  await expectContent(page);
  await expect(page.locator(".invitation-opening-content")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Enable animations" }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("slow hero stays blocked until decoding succeeds without waiting for galleries", async ({
  page,
}) => {
  let release!: () => void;
  let requested!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route("**/_next/image?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams
        .get("url")
        ?.startsWith("/assets/photography/cover-")
    ) {
      requested();
      await held;
    }
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(fixturePath, { waitUntil: "domcontentloaded" });
    await started;
    const open = page.getByRole("button", {
      name: "Open invitation",
      exact: true,
    });
    await expect(open).toBeDisabled();
    await expect(page.locator(".invitation-opening-content")).toHaveAttribute(
      "inert",
      "",
    );
    release();
    await expect(open).toBeEnabled();
    expect(
      await page
        .locator(".invitation-hero img")
        .evaluate(
          (image) =>
            (image as HTMLImageElement).complete &&
            (image as HTMLImageElement).naturalWidth > 0,
        ),
    ).toBe(true);
    await open.click();
    await expectContent(page);
  } finally {
    release();
  }
});

test("failed hero uses the native paper fallback and still opens once", async ({
  page,
}) => {
  await page.route("**/_next/image?**", (route) => {
    return new URL(route.request().url()).searchParams
      .get("url")
      ?.startsWith("/assets/photography/cover-")
      ? route.abort()
      : route.continue();
  });
  await page.goto(fixturePath);
  await expect(page.locator(".invitation-hero")).toHaveAttribute(
    "data-fallback",
    "true",
  );
  await expect(page.locator(".invitation-hero img")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expectContent(page);
});

test("never-settling hero releases readiness at the deadline with a stable fallback", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/image?**", async (route) => {
    if (
      new URL(route.request().url()).searchParams
        .get("url")
        ?.startsWith("/assets/photography/cover-")
    )
      await held;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(fixturePath, { waitUntil: "domcontentloaded" });
    const open = page.getByRole("button", {
      name: "Open invitation",
      exact: true,
    });
    await expect(open).toBeEnabled({
      timeout: invitationMotion.imageWait + 3000,
    });
    await expect(page.locator(".invitation-hero")).toHaveAttribute(
      "data-fallback",
      "true",
    );
    await open.click();
    await expectContent(page);
    release();
    await expect(page.locator(".invitation-hero")).toHaveAttribute(
      "data-fallback",
      "true",
    );
  } finally {
    release();
  }
});

test("font readiness failure is bounded and does not trap guests", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(document.fonts, "ready", {
      get: () => new Promise(() => {}),
      configurable: true,
    }),
  );
  await page.goto(fixturePath);
  await expect(
    page.getByRole("button", { name: "Open invitation", exact: true }),
  ).toBeEnabled({ timeout: invitationMotion.imageWait + 3000 });
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expectContent(page);
});

test("server markup is closed and authorized content stays inert before hydration", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(fixturePath);
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-stage",
      "closed",
    );
    await expect(page.locator(".invitation-opening-content")).toHaveAttribute(
      "inert",
      "",
    );
    await expect(
      page.getByRole("button", { name: "Open invitation", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: "Test Guest", exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("delayed JavaScript hydrates the same concealed content without a second retrieval", async ({
  page,
  request,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|hydrated|server rendered/i.test(message.text())
    )
      errors.push("hydration");
  });
  await page.route("**/_next/**", async (route) => {
    if (route.request().resourceType() === "script") await held;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(fixturePath, { waitUntil: "commit" });
    const content = page.locator(".invitation-opening-content");
    const open = page.getByRole("button", {
      name: "Open invitation",
      exact: true,
    });
    await expect(content).toHaveAttribute("inert", "");
    await expect(open).toBeDisabled();
    await open.evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-stage",
      "closed",
    );
    release();
    await expect(open).toBeEnabled();
    await open.click();
    await expectContent(page);
    await expect(content).toBeFocused();
    expect(errors).toEqual([]);
    expect(
      (await (await request.get(MOCK_API_ORIGIN + "/__count")).json()).count,
    ).toBe(1);
  } finally {
    release();
  }
});

for (const phase of ["preparing", "opening"] as const) {
  test(`navigation during ${phase} cancels work without trapping the next page`, async ({
    page,
  }) => {
    await page.clock.install();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.name));
    if (phase === "preparing")
      await page.route("**/_next/image?**", async (route) => {
        if (
          new URL(route.request().url()).searchParams
            .get("url")
            ?.startsWith("/assets/photography/cover-")
        )
          await held;
        await route.continue().catch(() => {});
      });
    try {
      await page.goto(fixturePath, { waitUntil: "domcontentloaded" });
      const open = page.getByRole("button", {
        name: "Open invitation",
        exact: true,
      });
      if (phase === "preparing") await expect(open).toBeDisabled();
      else {
        await expect(open).toBeEnabled();
        await open.click();
        await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
          "data-stage",
          "opening",
        );
      }
      await page.goto("/");
      release();
      await page.clock.fastForward(
        invitationMotion.imageWait +
          invitationMotion.fold +
          invitationMotion.fallbackGrace,
      );
      await expect(page.locator(".invitation-opening-flow")).toHaveCount(0);
      expect(
        await page.evaluate(() => getComputedStyle(document.body).overflow),
      ).not.toBe("hidden");
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });
}

test("reload resets the envelope and back/forward preserves an accessible journey", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(fixturePath);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expectContent(page);
  await page.reload();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "closed",
  );
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expectContent(page);
  await page.goto("/");
  await page.goBack();
  await expect(page.locator(".invitation-opening-flow")).toBeVisible();
  if (
    (await page
      .locator(".invitation-opening-flow")
      .getAttribute("data-stage")) === "closed"
  ) {
    await page
      .getByRole("button", { name: "Open invitation", exact: true })
      .click();
  }
  await expectContent(page);
  await page.goForward();
  await expect(page).toHaveURL("/");
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
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-stage",
      "content",
    );
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
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
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
  const directory = path.resolve(info.outputPath("visual-proof"));
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
    await page.locator(".invitation-hero img").evaluate(async (node) => {
      await (node as HTMLImageElement).decode();
    });
    await expect(
      page.locator('.invitation-hero[data-fallback="true"]'),
    ).toHaveCount(0);
    const heroReadyMs = await page.evaluate(
      () =>
        performance.now() -
        performance.getEntriesByName("design-open-start")[0]!.startTime,
    );
    await page.screenshot({
      path: path.join(directory, `runtime-opened-${width}.png`),
    });
    await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
      "data-stage",
      "content",
    );
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
