import { expect, test } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
let invitationId: string;
const original = "2027-06-01T11:30:45.678Z";

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
  await input.fill("2027-06-01T18:30:45");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
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
  await page.goto(path);
  await expect(input).toHaveValue("2027-06-02T00:15");
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
  await input.fill("2027-06-03T00:45");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("form", { name: "Edit invitation" }).getByRole("alert"),
  ).toContainText("not accepted");
  await expect(input).toHaveValue("2027-06-03T00:45");
  expect((await saved()).rsvpDeadlineAt?.toISOString()).toBe(
    "2027-06-01T17:15:00.000Z",
  );
  await page.unroute(`**/api/admin/invitations/${invitationId}`);
  await input.fill("");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/invitations/${invitationId}\\?updated=1`),
  );
  expect((await saved()).rsvpDeadlineAt).toBeNull();
  await page.goto(path);
  await expect(input).toHaveValue("");
});
