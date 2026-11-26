import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";
const origins = runnerOrigins();
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
test.beforeAll(async () => {
  fixture = await createWorkflowFixture();
});
test.afterAll(async () => {
  await fixture?.cleanup();
});
async function editor(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL("/", origins.admin).href);
  await page.goto("/event-content");
  await page
    .getByLabel("Event", { exact: true })
    .selectOption(fixture.event.id);
  await expect(
    page
      .getByRole("region", { name: "Event materials editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Saved state loaded.");
  await expect(
    page
      .getByRole("region", { name: "Event materials editor", exact: true })
      .getByRole("status"),
  ).toHaveClass(/action-feedback--info/);
}
test("real draft/upload/preview/publish/hide survives reload and controls guest media access", async ({
  page,
  browser,
}) => {
  const guest = await fixture.household("Venue content browser household");
  await editor(page);
  await page.getByLabel("Include parking guide", { exact: true }).check();
  await page
    .getByLabel("Parking title", { exact: true })
    .fill("Reception parking for guests");
  await page
    .getByLabel("Parking instructions (one per line)", { exact: true })
    .fill("Use the guest entrance.\nFollow the venue signs.");
  await page.getByLabel("Include event rundown", { exact: true }).check();
  await page
    .getByLabel("Rundown title", { exact: true })
    .fill("Guest schedule");
  await page.getByRole("button", { name: "Add activity", exact: true }).click();
  await page
    .getByLabel("Start (WIB) 1", { exact: true })
    .fill("2027-01-09T11:30");
  await page
    .getByLabel("Activity title 1", { exact: true })
    .fill("Guest arrival");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Event materials editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Draft saved. Published content is unchanged.");
  await expect(
    page
      .getByRole("region", { name: "Event materials editor", exact: true })
      .getByRole("status"),
  ).toHaveClass(/action-feedback--success/);
  const publicContext = await browser.newContext({
    baseURL: origins.invitation,
  });
  const publicRead = () =>
    publicContext.request.get(
      `${origins.api}/api/public/invitations/${guest.publicCredential}/venue-content`,
    );
  try {
    expect((await (await publicRead()).json()).items).toEqual([]);
    await page.reload();
    await page
      .getByLabel("Event", { exact: true })
      .selectOption(fixture.event.id);
    await expect(page.getByLabel("Parking title", { exact: true })).toHaveValue(
      "Reception parking for guests",
    );
    await page.getByLabel("Upload file", { exact: true }).setInputFiles({
      name: "parking.png",
      mimeType: "image/png",
      buffer: readFileSync(resolve(__dirname, "fixtures/parking-map.png")),
    });
    await page
      .getByRole("button", { name: "Upload supporting file", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Event materials editor", exact: true })
        .getByRole("status"),
    ).toHaveText("File uploaded. Select it below, then save the draft.");
    await page
      .getByLabel("Parking map", { exact: true })
      .selectOption({ index: 1 });
    await page
      .getByLabel("Map description", { exact: true })
      .fill("Guest entrance and parking area");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Event materials editor", exact: true })
        .getByRole("status"),
    ).toHaveText("Draft saved. Published content is unchanged.");
    await page
      .getByRole("button", { name: "Preview draft", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Material preview" }),
    ).toContainText("11.30 WIB");
    await expect(
      page.getByAltText("Guest entrance and parking area"),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // OWNER editor with synthetic content only; no guest page, credential or QR.
    await page.screenshot({
      path: "test-results/event-materials-admin-390.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Publish saved draft", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm action", exact: true })
      .click();
    await expect(page.getByText(/Published snapshot available/)).toBeVisible();
    const state = await fixture.prisma.eventContent.findUniqueOrThrow({
      where: { eventId: fixture.event.id },
    });
    const published = state.published as { parking: { mapAssetId: string } };
    const mediaUrl = `/i/${guest.publicCredential}/venue-assets/${published.parking.mapAssetId}`;
    const media = await publicContext.request.get(mediaUrl);
    expect(media.status()).toBe(200);
    expect(media.headers()["content-type"]).toBe("image/png");
    expect(media.headers()["cache-control"]).toBe("no-store");
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`/i/${guest.publicCredential}`);
    await publicPage
      .getByRole("button", { name: "Buka Undangan", exact: true })
      .click();
    await expect(
      publicPage.locator(".invitation-opening-flow"),
    ).toHaveAttribute("data-stage", "content");
    await expect(
      publicPage.getByRole("region", { name: "Panduan Parkir", exact: true }),
    ).toContainText("Reception parking for guests");
    await expect(
      publicPage.getByAltText("Guest entrance and parking area"),
    ).toBeVisible();
    await page
      .getByLabel("Parking title", { exact: true })
      .fill("Unpublished edit");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Event materials editor", exact: true })
        .getByRole("status"),
    ).toHaveText("Draft saved. Published content is unchanged.");
    expect(
      (await (await publicRead()).json()).items[0].content.parking.title,
    ).toBe("Reception parking for guests");
    await page
      .getByRole("button", { name: "Hide published content", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm action", exact: true })
      .click();
    await expect(page.getByText(/Not published/)).toBeVisible();
    expect((await (await publicRead()).json()).items).toEqual([]);
    expect((await publicContext.request.get(mediaUrl)).status()).toBe(404);
    expect(
      (
        await fixture.prisma.event.findUniqueOrThrow({
          where: { id: fixture.event.id },
        })
      ).startsAt?.toISOString(),
    ).toBe("2027-01-02T10:00:00.000Z");
  } finally {
    await publicContext.close();
  }
});
test("lost save response blocks mutation until explicit authoritative reload, without auto replay", async ({
  page,
}) => {
  await editor(page);
  const before = await fixture.prisma.eventContent.findUnique({
    where: { eventId: fixture.event.id },
  });
  await page.getByLabel("Include parking guide", { exact: true }).check();
  await page
    .getByLabel("Parking title", { exact: true })
    .fill("Lost response draft");
  let saves = 0;
  await page.route(
    `**/api/admin/event-content/${fixture.event.id}`,
    async (route) => {
      if (route.request().method() === "PUT") {
        saves++;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    },
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Event materials editor", exact: true })
      .getByRole("status"),
  ).toContainText("result is uncertain");
  await expect(
    page
      .getByRole("region", { name: "Event materials editor", exact: true })
      .getByRole("status"),
  ).toHaveClass(/action-feedback--warning/);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Publish saved draft", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reload saved state", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm action", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Event materials editor", exact: true })
      .getByRole("status"),
  ).toHaveText("Saved state loaded.");
  await expect(page.getByLabel("Parking title", { exact: true })).toHaveValue(
    "Lost response draft",
  );
  expect(saves).toBe(1);
  expect(
    (
      await fixture.prisma.eventContent.findUniqueOrThrow({
        where: { eventId: fixture.event.id },
      })
    ).version,
  ).toBe((before?.version ?? 0) + 1);
});

test("event material feedback stays informational while pending and reports rejected inputs as errors", async ({
  page,
}) => {
  await editor(page);
  const workspace = page.getByRole("region", {
    name: "Event materials editor",
    exact: true,
  });
  await page.getByLabel("Include parking guide", { exact: true }).check();
  await page
    .getByLabel("Parking title", { exact: true })
    .fill("Pending feedback review");
  let release!: () => void, requested!: () => void;
  const held = new Promise<void>((done) => (release = done)),
    received = new Promise<void>((done) => (requested = done));
  const path = `**/api/admin/event-content/${fixture.event.id}`;
  await page.route(path, async (route) => {
    if (route.request().method() === "PUT") {
      requested();
      await held;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await received;
    await expect(workspace.getByRole("status")).toHaveClass(
      /action-feedback--info/,
    );
    await expect(workspace.getByRole("status")).toHaveText(
      "Updating event materials…",
    );
  } finally {
    release();
  }
  await expect(workspace.getByRole("status")).toHaveClass(
    /action-feedback--success/,
  );
  await page.unroute(path);
  await page.getByLabel("Upload file", { exact: true }).setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic invalid file"),
  });
  await page
    .getByRole("button", { name: "Upload supporting file", exact: true })
    .click();
  await expect(workspace.getByRole("alert")).toHaveClass(
    /action-feedback--error/,
  );
  await expect(workspace.getByRole("alert")).toContainText(
    "Choose a supported file",
  );
  await page.route(path, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({
      status: 400,
      json: {
        error: { code: "VALIDATION_ERROR", message: "Synthetic rejection" },
      },
    });
  });
  await page
    .getByLabel("Parking title", { exact: true })
    .fill("Preserve rejected material draft");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(workspace.getByRole("alert")).toHaveClass(
    /action-feedback--error/,
  );
  await expect(page.getByLabel("Parking title", { exact: true })).toHaveValue(
    "Preserve rejected material draft",
  );
});

test("Rundown date edits keep invalid input separate from empty draft times", async ({
  page,
}) => {
  const firstTime = "2027-01-02T10:00:37.456Z";
  const secondTime = "2027-01-02T12:00:19.123Z";
  const draft = {
    parking: null,
    rundown: {
      title: "Synthetic schedule",
      items: [
        { startsAt: firstTime, title: "First activity", description: "" },
        { startsAt: secondTime, title: "Second activity", description: "" },
      ],
    },
  };
  const eventId = fixture.event.id;
  await fixture.prisma.eventContent.upsert({
    where: { eventId },
    create: { eventId, draft },
    update: { draft },
  });
  const persisted = async () =>
    fixture.prisma.eventContent.findUniqueOrThrow({ where: { eventId } });
  await editor(page);
  const first = page.getByLabel("Start (WIB) 1", { exact: true });
  const second = page.getByLabel("Start (WIB) 2", { exact: true });
  const clear = page.getByRole("button", { name: "Clear activity 1 time" });
  for (const width of [320, 375, 412, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const control of [first, clear]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
  }
  const save = page.getByRole("button", { name: "Save draft", exact: true });
  const success = page.getByText(
    "Draft saved. Published content is unchanged.",
    { exact: true },
  );
  let writes = 0;
  let uploads = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      path === `/api/admin/event-content/${eventId}/assets`
    )
      uploads++;
    if (
      request.method() === "PUT" &&
      path === `/api/admin/event-content/${eventId}`
    )
      writes++;
  });

  const beforeInvalid = await persisted();
  await clear.click();
  await first.press("1");
  await page.getByLabel("Activity title 2", { exact: true }).focus();
  expect(
    await first.evaluate(
      (input: HTMLInputElement) =>
        input.validity.badInput && input.value === "",
    ),
  ).toBe(true);
  await expect(first).toHaveAttribute("aria-invalid", "false");
  await save.click();
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(first).toBeFocused();
  await expect(success).toHaveCount(0);
  expect(writes).toBe(0);
  expect(await persisted()).toEqual(beforeInvalid);

  await first.fill("2027-01-02T17:00:45");
  await save.click();
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(first).toBeFocused();
  await expect(success).toHaveCount(0);
  expect(writes).toBe(0);
  await first.fill("2027-01-02T17:00");
  await first.press("ArrowLeft");
  await first.press("Backspace");
  expect(
    await first.evaluate(
      (input: HTMLInputElement) =>
        input.validity.badInput && input.value === "",
    ),
  ).toBe(true);
  await save.click();
  await expect(first).toHaveAttribute("aria-invalid", "true");
  expect(writes).toBe(0);
  expect(await persisted()).toEqual(beforeInvalid);

  await page.getByRole("button", { name: "Reload saved state" }).click();
  await page.getByRole("button", { name: "Confirm action" }).click();
  await expect(first).toHaveValue("2027-01-02T17:00");
  await page
    .getByLabel("Activity title 2", { exact: true })
    .fill("Renamed second activity");
  await save.click();
  await expect(success).toBeVisible();
  expect((await persisted()).draft).toMatchObject({
    rundown: {
      items: [
        { startsAt: firstTime },
        { startsAt: secondTime, title: "Renamed second activity" },
      ],
    },
  });

  await second.fill("2027-01-02T19:00:45.678");
  await save.click();
  await expect(second).toHaveAttribute("aria-invalid", "true");
  expect(writes).toBe(1);
  await page.getByRole("button", { name: "Clear activity 2 time" }).click();
  await second.press("1");
  await page.getByRole("button", { name: "Remove activity 1" }).click();
  expect(
    await first.evaluate(
      (input: HTMLInputElement) =>
        input.validity.badInput && input.value === "",
    ),
  ).toBe(true);
  await expect(
    page.getByLabel("Activity title 1", { exact: true }),
  ).toHaveValue("Renamed second activity");
  const beforeRemovalSave = await persisted();
  await page.getByLabel("Upload file", { exact: true }).setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });
  await page.getByRole("button", { name: "Upload supporting file" }).click();
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(first).toBeFocused();
  expect(uploads).toBe(0);
  await save.click();
  await expect(first).toBeFocused();
  await expect(success).toHaveCount(0);
  expect(writes).toBe(1);
  expect(await persisted()).toEqual(beforeRemovalSave);

  await page.getByRole("button", { name: "Clear activity 1 time" }).click();
  await first.fill("2027-01-02T19:15");
  const add = page.getByRole("button", { name: "Add activity", exact: true });
  await add.click();
  await page
    .getByLabel("Activity title 2", { exact: true })
    .fill("New optional time");
  await add.click();
  await page
    .getByLabel("Activity title 3", { exact: true })
    .fill("New scheduled activity");
  await page
    .getByLabel("Start (WIB) 3", { exact: true })
    .fill("2027-01-02T20:30");
  await save.click();
  await expect(success).toBeVisible();
  expect((await persisted()).draft).toMatchObject({
    rundown: {
      items: [
        { startsAt: "2027-01-02T12:15:00.000Z" },
        { startsAt: "" },
        { startsAt: "2027-01-02T13:30:00.000Z" },
      ],
    },
  });
  await page.getByRole("button", { name: "Clear activity 1 time" }).click();
  await save.click();
  await expect(success).toBeVisible();
  expect((await persisted()).draft).toMatchObject({
    rundown: {
      items: [
        { startsAt: "" },
        { startsAt: "" },
        { startsAt: "2027-01-02T13:30:00.000Z" },
      ],
    },
  });
  expect((await persisted()).published).toEqual(beforeInvalid.published);
  await page.getByRole("button", { name: "Publish saved draft" }).click();
  await page.getByRole("button", { name: "Confirm action" }).click();
  await expect(page.getByText(/Validation rejected/)).toBeVisible();
  await page.getByRole("button", { name: "Reload saved state" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm action" })
    .click();
  await expect(
    page.getByText("Saved state loaded.", { exact: true }),
  ).toBeVisible();
  await expect(first).toHaveValue("");
  await expect(second).toHaveValue("");
  await expect(page.getByLabel("Start (WIB) 3", { exact: true })).toHaveValue(
    "2027-01-02T20:30",
  );
  expect(writes).toBe(3);
});
