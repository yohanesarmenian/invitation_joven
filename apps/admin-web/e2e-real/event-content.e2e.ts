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
      .getByRole("button", { name: "Open invitation", exact: true })
      .click();
    await expect(
      publicPage.locator(".invitation-opening-flow"),
    ).toHaveAttribute("data-stage", "content");
    await expect(
      publicPage.getByRole("region", { name: "Parking Guide", exact: true }),
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
