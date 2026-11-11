import { expect, test, type Page } from "@playwright/test";
import { MOCK_API_ORIGIN } from "./harness";
import { typographyFixtures } from "./typography-fixtures";

test.beforeEach(async ({ request, page }) => {
  expect((await request.post(`${MOCK_API_ORIGIN}/__reset`)).status()).toBe(204);
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function open(page: Page, credential: string) {
  await page.goto(`/i/${credential}`);
  await page
    .getByRole("button", { name: "Open invitation", exact: true })
    .click();
  await expect(page.locator(".invitation-opening-flow")).toHaveAttribute(
    "data-stage",
    "content",
  );
  await page.evaluate(() => document.fonts.ready);
}

async function expectReadableText(page: Page) {
  const clipped = await page
    .locator(".invitation-opening-content")
    .evaluate((root) => {
      const failures: {
        tag: string;
        section: string;
        left: number;
        right: number;
      }[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const element = node.parentElement;
        if (
          !node.textContent?.trim() ||
          !element?.checkVisibility() ||
          element.closest(".visually-hidden,script,style")
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && (rect.left < -2 || rect.right > innerWidth + 2))
            failures.push({
              tag: element.tagName,
              section: element.closest("section")?.className ?? "",
              left: rect.left,
              right: rect.right,
            });
        }
      }
      return failures;
    });
  expect(clipped).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const width of [320, 375, 412, 768, 1280]) {
  test(`one typography hierarchy wraps personal and display-only group labels at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const fixture of typographyFixtures) {
      await open(page, fixture.credential);
      await expect(page.locator("#invitation-title")).toHaveText(fixture.name);
      const greetingArtCollision = await page
        .locator(".invitation-header")
        .evaluate((header) => {
          const art = header
            .querySelector(".decoration-top")!
            .getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(header.querySelector("h1")!);
          return [...range.getClientRects()].some(
            (rect) =>
              rect.left < art.right &&
              rect.right > art.left &&
              rect.top < art.bottom &&
              rect.bottom > art.top,
          );
        });
      expect(greetingArtCollision).toBe(false);
      await expect(page.locator("#dress-code-title")).toHaveText("Dress Code");
      await expect(page.getByText("Fine Attire", { exact: true })).toHaveCount(
        0,
      );
      for (const selector of [
        "#couple-title",
        "#events-title",
        "#dress-code-title",
        "#gallery-title",
        "#rsvp-title",
        "#message-title",
      ]) {
        await expect(page.locator(selector)).toHaveCSS(
          "font-family",
          await page
            .locator("#dress-code-title")
            .evaluate((e) => getComputedStyle(e).fontFamily),
        );
        await expect(page.locator(selector)).toHaveCSS(
          "font-size",
          await page
            .locator("#dress-code-title")
            .evaluate((e) => getComputedStyle(e).fontSize),
        );
      }
      for (const selector of [
        ".section-kicker",
        ".invitation-hero-kicker",
        ".countdown-label",
        ".event-number",
        ".event-time-zone",
      ]) {
        for (const label of await page.locator(selector).all()) {
          await expect(label).toHaveCSS("text-transform", "none");
          await expect(label).toHaveCSS("letter-spacing", "normal");
        }
      }
      await expect(page.locator(".rsvp-submit")).toHaveCSS(
        "font-family",
        /Albert Sans/,
      );
      await expect(page.locator(".closing-copy")).toHaveCSS(
        "font-family",
        /Spectral/,
      );
      const scriptOutsideIdentity = await page
        .locator(".invitation-opening-content")
        .evaluate(
          (root) =>
            [...root.querySelectorAll("h1,h2,h3,p,label,button,cite")].filter(
              (e) =>
                getComputedStyle(e).fontFamily.includes("Luxurious Script") &&
                !e.closest(".invitation-hero-title"),
            ).length,
        );
      expect(scriptOutsideIdentity).toBe(0);
      await expectReadableText(page);
    }
  });

  test(`200 percent browser default text remains readable and keyboard usable at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const cdp = await context.newCDPSession(page);
    // Change Chromium's font-size setting, not CSS, DPR or a screenshot scale.
    await cdp.send("Page.setFontSizes", {
      fontSizes: { standard: 32, fixed: 26 },
    });
    await page.goto(`/i/${typographyFixtures[1]!.credential}`);
    await expect(page.locator("html")).toHaveCSS("font-size", "32px");
    const openButton = page.getByRole("button", {
      name: "Open invitation",
      exact: true,
    });
    await expect(openButton).toBeEnabled();
    const collisions = await page.evaluate(() => {
      const selectors = [
        ".invitation-envelope-heading",
        ".invitation-envelope-wax",
        ".invitation-envelope-hint",
        ".invitation-envelope-foot",
      ];
      const boxes = selectors.map((selector) =>
        document.querySelector(selector)!.getBoundingClientRect(),
      );
      return boxes.some((a, index) =>
        boxes
          .slice(index + 1)
          .some(
            (b) =>
              a.left < b.right &&
              a.right > b.left &&
              a.top < b.bottom &&
              a.bottom > b.top,
          ),
      );
    });
    expect(collisions).toBe(false);
    await openButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".invitation-opening-content")).toBeFocused();
    await expectReadableText(page);
    const radio = page.getByRole("radio", { name: "Joyfully Accept" });
    await radio.focus();
    await page.keyboard.press("Space");
    await expect(radio).toBeChecked();
    await expect(radio).toBeFocused();
    const submit = page.getByRole("button", {
      name: /^(Submit RSVP|Save Changes)$/,
      exact: true,
    });
    await submit.focus();
    await expect(submit).toBeFocused();
    await expect(submit).toHaveCSS("outline-style", "solid");
    await expectReadableText(page);
  });
}

test("recoverable invitation errors use the same readable type and keyboard action", async ({
  page,
}) => {
  await page.goto(`/i/${"C".repeat(43)}`);
  await expect(
    page.getByRole("heading", { name: "Unable to load the invitation" }),
  ).toBeVisible();
  await expect(page.locator("#invitation-error-title")).toHaveCSS(
    "font-family",
    /Spectral/,
  );
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(retry).toHaveCSS("font-family", /Albert Sans/);
  await retry.focus();
  await expect(retry).toBeFocused();
  await expect(retry).toHaveCSS("outline-style", "solid");
});
