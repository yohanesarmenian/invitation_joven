import { expect, test, type Page, type Route } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
let invitationId: string;
const original = "2027-06-01T11:30:45.678Z";

async function editBeforeHydration(
  page: Page,
  path: string,
  edit: () => Promise<void>,
) {
  const scripts = /\/_next\/static\/[^?]+\.js(?:\?|$)/;
  let heldScripts = 0;
  const gate = Promise.withResolvers<void>();
  const hold = async (route: Route) => {
    heldScripts++;
    await gate.promise;
    await route.continue();
  };
  await page.route(scripts, hold);
  try {
    await page.goto(path, { waitUntil: "commit" });
    await expect.poll(() => heldScripts).toBeGreaterThan(0);
    await edit();
  } finally {
    gate.resolve();
    await page.waitForLoadState("load");
    await page.unroute(scripts, hold);
  }
}

test.beforeAll(async () => {
  fixture = await createWorkflowFixture();
  const household = await fixture.household(
    "Deadline precision browser household",
    { pending: true },
  );
  invitationId = household.id;
  await fixture.prisma.invitation.update({
    where: { id: invitationId },
    data: { rsvpDeadlineAt: new Date(original) },
  });
});
test.afterAll(async () => {
  await fixture?.cleanup();
});

test("deadline invalid input never mutates PostgreSQL and untouched timestamps valid minutes and clear persist", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.owner.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL("/", runnerOrigins().admin).href);
  const path = `/invitations/${invitationId}/edit`;
  const input = page.getByLabel("RSVP deadline", { exact: true });
  const clear = page.getByRole("button", { name: "Clear RSVP deadline" });
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  const saved = () =>
    fixture.prisma.invitation.findUniqueOrThrow({
      where: { id: invitationId },
    });
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname ===
        `/api/admin/invitations/${invitationId}`
    )
      writes++;
  });
  await page.goto(path);
  await expect(input).toHaveValue("2027-06-01T18:30");
  const beforeInvalid = await saved();
  await clear.click();
  await input.press("1");
  await page
    .getByLabel("Internal notes", { exact: true })
    .fill("Keep local notes through native validation");
  expect(
    await input.evaluate(
      (element: HTMLInputElement) =>
        element.validity.badInput && element.value === "",
    ),
  ).toBe(true);
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await save.click();
  await expect(page.locator("#deadline-error")).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  expect(writes).toBe(0);
  expect(await saved()).toEqual(beforeInvalid);
  await input.fill("2027-06-01T18:30:45");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(writes).toBe(0);
  expect((await saved()).rsvpDeadlineAt?.toISOString()).toBe(original);
  await input.fill("2027-06-01T18:30");
  await input.press("ArrowLeft");
  await input.press("Backspace");
  expect(
    await input.evaluate(
      (element: HTMLInputElement) =>
        element.validity.badInput && element.value === "",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(writes).toBe(0);
  expect((await saved()).rsvpDeadlineAt?.toISOString()).toBe(original);
  await page.reload();
  await expect(input).toHaveValue("2027-06-01T18:30");
  await page
    .getByLabel("Internal notes", { exact: true })
    .fill("Preserve canonical precision");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/invitations/${invitationId}\\?updated=1`),
  );
  expect((await saved()).rsvpDeadlineAt?.toISOString()).toBe(original);
  await page.goto(path);
  await expect(input).toHaveValue("2027-06-01T18:30");
  await clear.click();
  await input.fill("2027-06-02T00:15");
  const before = writes;
  await page
    .getByRole("button", { name: "Save changes", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(page).toHaveURL(
    new RegExp(`/invitations/${invitationId}\\?updated=1`),
  );
  expect(writes - before).toBe(1);
  expect((await saved()).rsvpDeadlineAt?.toISOString()).toBe(
    "2027-06-01T17:15:00.000Z",
  );
  const beforeRejection = await saved();
  await page.route(
    `**/api/admin/invitations/${invitationId}`,
    async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await route.fulfill({
        status: 400,
        json: {
          error: { code: "VALIDATION_ERROR", message: "Synthetic rejection" },
        },
      });
    },
  );
  await editBeforeHydration(page, path, async () => {
    await expect(input).toHaveValue("2027-06-02T00:15");
    await input.fill("2027-06-03T00:45");
    await expect(input).toHaveValue("2027-06-03T00:45");
  });
  await expect(input).toHaveValue("2027-06-03T00:45");
  await page
    .getByLabel("Internal notes", { exact: true })
    .fill("Unrelated draft edit after hydration");
  const rejected = page.waitForResponse(
    (response) => response.request().method() === "PATCH",
  );
  const beforeRejectedRequest = writes;
  await save.click();
  const response = await rejected;
  expect(response.status()).toBe(400);
  await expect(
    page.getByRole("form", { name: "Edit invitation" }).getByRole("alert"),
  ).toContainText("not accepted");
  await expect(input).toHaveValue("2027-06-03T00:45");
  expect(response.request().postDataJSON()).toMatchObject({
    rsvpDeadlineAt: "2027-06-02T17:45:00.000Z",
  });
  expect(writes - beforeRejectedRequest).toBe(1);
  expect(await saved()).toEqual(beforeRejection);
  await page.unroute(`**/api/admin/invitations/${invitationId}`);
  const beforeCorrection = writes;
  await input.fill("2027-06-03T01:00");
  await save.click();
  await expect(page).toHaveURL(
    new RegExp(`/invitations/${invitationId}\\?updated=1`),
  );
  expect(writes - beforeCorrection).toBe(1);
  const corrected = await saved();
  expect(corrected.rsvpDeadlineAt?.toISOString()).toBe(
    "2027-06-02T18:00:00.000Z",
  );
  await editBeforeHydration(page, path, async () => {
    await expect(input).toHaveValue("2027-06-03T01:00");
    for (let i = 0; i < 6; i++) await input.press("ArrowLeft");
    await input.press("Backspace");
    expect(
      await input.evaluate(
        (element: HTMLInputElement) =>
          element.validity.badInput && element.value === "",
      ),
    ).toBe(true);
  });
  const beforePartial = writes;
  await save.click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  expect(writes).toBe(beforePartial);
  expect(await saved()).toEqual(corrected);
  const beforeClear = writes;
  await clear.click();
  await expect(input).toHaveValue("");
  const clearing = page.waitForResponse(
    (response) => response.request().method() === "PATCH",
  );
  await save.click();
  const cleared = await clearing;
  expect(cleared.status()).toBe(200);
  expect(cleared.request().postDataJSON()).toMatchObject({
    rsvpDeadlineAt: null,
  });
  await expect(page).toHaveURL(
    new RegExp(`/invitations/${invitationId}\\?updated=1`),
  );
  expect((await saved()).rsvpDeadlineAt).toBeNull();
  expect(writes - beforeClear).toBe(1);
  await page.goto(path);
  await expect(input).toHaveValue("");
});
