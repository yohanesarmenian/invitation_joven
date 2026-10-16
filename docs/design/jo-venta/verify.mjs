// Focused browser verification of the isolated design prototype, not application/API tests.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, "review");
await fs.mkdir(out, { recursive: true });
const url = `http://127.0.0.1:${process.env.DESIGN_PREVIEW_PORT ?? 4317}`;
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const checks = [];
const requests = [];
const errors = [];
const record = (name, details = {}) =>
  checks.push({ name, status: "passed", ...details });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Asia/Jakarta",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  page.on("request", (request) =>
    requests.push({ method: request.method(), url: request.url() }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  assert(await page.locator("#closed-stage").isVisible());
  await page.screenshot({ path: path.join(out, "mobile-envelope.png") });
  await page.locator("#open-envelope").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.locator("#opened-stage").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "view-invitation",
  );
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "mobile-opened.png") });
  record(
    "Envelope keyboard opening and repeated activation reach opened state with focus",
  );
  await page.keyboard.press("Space");
  await page.locator("#content-stage").waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "invitation-content",
  );
  record("Opened cover keyboard activation reaches invitation content");

  for (const width of [320, 360, 390, 412, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
    await page.goto(`${url}/?view=content`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#guest-heading").evaluate((node) => {
      node.textContent = "Maya Prameswari & Aditya Wiratama and Family";
    });
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector("main").getBoundingClientRect().width,
    }));
    assert(
      geometry.documentWidth <= width + 1,
      `overflow at ${width}: ${geometry.documentWidth}`,
    );
    assert(geometry.mainWidth <= width + 1);
    record("Responsive layout and long guest name", geometry);
  }
  await page.goto(`${url}/?view=content`);
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.locator("#content-stage").boundingBox();
  assert.equal(layout.width, 1440);
  const panel = await page.locator(".identity-panel").boundingBox();
  assert(Math.abs(panel.width - 1440 * 0.49) < 1);
  for (const role of ["bride", "groom"]) {
    const photo = await page
      .locator(`.${role}-profile .portrait`)
      .boundingBox();
    const copy = await page
      .locator(`.${role}-profile .profile-copy`)
      .boundingBox();
    assert(Math.abs(photo.x - copy.x) < 1);
    assert(photo.y + photo.height <= copy.y + 1);
  }
  record(
    "First owner-photo layout: desktop photo panel and large portraits above copy",
  );
  await page.locator("#rsvp").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "desktop-rsvp.png") });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: path.join(out, "desktop-content.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${url}/?view=content`);
  await page.locator('#rsvp-form button[type="submit"]').click();
  assert(await page.locator("#rsvp-error").isVisible());
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "rsvp-error",
  );
  await page.locator(".rsvp-section").screenshot({
    path: path.join(out, "mobile-rsvp-error.png"),
    style: ".review-bar,.section-nav{visibility:hidden!important}",
  });
  record("RSVP validation is visible and focused");
  await page.locator('input[name="attendance"][value="accepted"]').check();
  await page.locator('#rsvp-form button[type="submit"]').click();
  assert(await page.locator("#feedback-dialog").isVisible());
  assert(await page.locator("#pass-preview").isVisible());
  assert.equal(
    await page.locator("#pass-preview svg, #pass-preview canvas").count(),
    0,
  );
  await page
    .locator("#feedback-dialog")
    .screenshot({ path: path.join(out, "mobile-confirmation.png") });
  await page.keyboard.press("Escape");
  assert(
    await page
      .locator('#rsvp-form button[type="submit"]')
      .evaluate((node) => node === document.activeElement),
  );
  record(
    "Accepted confirmation has explicit non-scannable pass review area; Escape restores focus",
  );
  await page.locator('input[name="attendance"][value="declined"]').check();
  assert(await page.locator("#attendance-details").isHidden());
  await page.locator('#rsvp-form button[type="submit"]').click();
  assert(await page.locator("#pass-preview").isHidden());
  assert.equal(
    await page.locator("#feedback-title").innerText(),
    "Thank you for letting us know",
  );
  await page.locator("#feedback-back").click();
  record("Declined confirmation has no pass and hides attendance composition");
  await page.locator(".review-states summary").click();
  for (const state of ["conflict", "uncertain", "deadline"]) {
    await page.locator(`[data-state="${state}"]`).click();
    assert(await page.locator("#feedback-dialog").isVisible());
    assert(await page.locator("#pass-preview").isHidden());
    await page.keyboard.press("Escape");
    record(`Review state: ${state}`);
  }
  await page.locator('[data-photo="0"]').click();
  assert(await page.locator("#photo-dialog").isVisible());
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#photo-position").innerText(), "2 / 4");
  await page.keyboard.press("Escape");
  assert(
    await page
      .locator('[data-photo="0"]')
      .evaluate((node) => node === document.activeElement),
  );
  record("Gallery native dialog supports arrows, Escape and focus return");
  await page.locator('#message-form button[type="submit"]').click();
  assert(await page.locator("#message-error").isVisible());
  await page
    .locator("#message")
    .fill("A sample warm wish for the design review.");
  await page.locator('#message-form button[type="submit"]').click();
  assert.equal(
    await page.locator("#feedback-title").innerText(),
    "Message Sent!",
  );
  await page.keyboard.press("Escape");
  record("Message validation and confirmation are simulated locally");

  await page.goto(`${url}/?view=content`);
  for (const selector of [
    ".bride-profile",
    ".groom-profile",
    "#events",
    "#rsvp",
    "#gallery",
    ".closing-section",
  ]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.waitForTimeout(60);
  }
  await page.evaluate(async () => {
    await Promise.all(
      [...document.images]
        .filter((img) => !img.closest("[hidden]"))
        .map((img) => img.decode().catch(() => {})),
    );
  });
  const brokenImages = await page.evaluate(
    () =>
      [...document.querySelectorAll("#content-stage img")].filter(
        (img) => !img.naturalWidth,
      ).length,
  );
  assert.equal(brokenImages, 0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(out, "mobile-content.png"),
    fullPage: true,
  });
  await page.locator(".bride-profile").screenshot({
    path: path.join(out, "mobile-bride.png"),
    style: ".review-bar,.section-nav{visibility:hidden!important}",
  });
  await page.locator(".gallery-section").screenshot({
    path: path.join(out, "mobile-gallery.png"),
    style: ".review-bar,.section-nav{visibility:hidden!important}",
  });
  const fonts = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load("16px Spectral"),
      document.fonts.load("32px Parisienne"),
    ]);
    return [
      document.fonts.check("16px Spectral"),
      document.fonts.check("32px Parisienne"),
    ];
  });
  assert(fonts.every(Boolean));
  record(
    "Every content image is nonempty and existing project font aliases load",
    { brokenImages, fonts },
  );

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url);
  await page.locator("#open-envelope").click();
  assert(await page.locator("#opened-stage").isVisible());
  assert.equal(
    await page
      .locator("#opened-stage")
      .evaluate((node) => getComputedStyle(node).animationName),
    "none",
  );
  await page.locator("#view-invitation").click();
  assert.equal(
    await page
      .locator(".profile")
      .first()
      .evaluate((node) => getComputedStyle(node).animationName),
    "none",
  );
  record("Reduced motion removes animation and opening delay");
  await page.addInitScript(() => {
    window.IntersectionObserver = undefined;
  });
  await page.goto(`${url}/?view=content`);
  assert(await page.locator(".bride-profile").isVisible());
  record("Missing motion observer leaves content visible");
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const staticPage = await noJs.newPage();
  await staticPage.goto(url);
  assert(await staticPage.locator("#content-stage").isVisible());
  record(
    "No JavaScript retains readable long content; interactive preview controls require JavaScript",
  );
  await noJs.close();
  assert.equal(
    requests.filter((request) => request.method !== "GET").length,
    0,
  );
  assert.equal(
    requests.filter((request) => new URL(request.url).origin !== url).length,
    0,
  );
  assert.deepEqual(errors, []);
  record(
    "No API writes, third-party requests, HTTP failures or browser exceptions",
    { observedRequests: requests.length },
  );
  await context.close();
  await fs.writeFile(
    path.join(out, "verification.json"),
    JSON.stringify(
      {
        date: new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Jakarta",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()),
        browser: await browser.version(),
        scope:
          "Isolated design prototype, synthetic household data; not production application verification",
        checks,
        errors,
        requests: { count: requests.length, nonGet: 0, external: 0 },
        limitations: [
          "No Safari/iOS or physical-device verification",
          "RSVP/QR/messages are local simulations, not API or database tests",
          "200 percent browser zoom and screen reader audit remain future application QA",
          "Final owner wording and composition review remain pending",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      checks: checks.length,
      screenshots: (await fs.readdir(out)).filter((name) =>
        name.endsWith(".png"),
      ),
      errors,
    }),
  );
} finally {
  await browser.close();
}
