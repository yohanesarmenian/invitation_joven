import { expect, test, type Page } from "@playwright/test";
import { createWorkflowFixture } from "../../api/scripts/admin-workflow-fixture";
import { runnerOrigins } from "./origins";
const { admin: ADMIN_ORIGIN } = runnerOrigins();
let fixture: Awaited<ReturnType<typeof createWorkflowFixture>>;
test.beforeAll(async () => {
  fixture = await createWorkflowFixture();
});
test.afterAll(async () => {
  await fixture?.cleanup();
});
async function login(
  page: Page,
  email: string,
  password = fixture.password,
  landing = email === fixture.owner.email ? "/" : "/checkin",
) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new URL(landing, ADMIN_ORIGIN).href);
}
test("personal message reads the current link without recording an open and detects rotation before copy", async ({
  page,
}) => {
  const household = await fixture.household("Workflow Message Household");
  await login(page, fixture.owner.email);
  await page.addInitScript(() => {
    Object.assign(window, { copiedMessages: [] });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Reflect.get(window, "copiedMessages").push(value);
        },
      },
    });
  });
  await page.goto(`/invitations/${household.id}`);
  await page.getByRole("button", { name: "Prepare personal message" }).click();
  const preview = page.getByLabel("Message preview");
  await expect(preview).toContainText(household.name);
  await expect(preview).toContainText(fixture.event.name);
  await page
    .getByRole("button", { name: "Copy personal message", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "copiedMessages").length),
    )
    .toBe(1);
  const auth = await (await page.request.get("/api/admin/auth/me")).json();
  const rotation = await page.request.post(
    `/api/admin/invitations/${household.id}/regenerate-token`,
    {
      headers: {
        Origin: ADMIN_ORIGIN,
        "X-CSRF-Token": auth.csrfToken,
      },
      data: { expectedTokenVersion: 1 },
    },
  );
  expect(rotation.status()).toBe(200);
  await page
    .getByRole("button", { name: "Copy personal message", exact: true })
    .click();
  await expect(page.getByText(/The invitation link changed/)).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "copiedMessages").length),
  ).toBe(1);
  await page
    .getByRole("button", { name: "Copy personal message", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => Reflect.get(window, "copiedMessages").length),
    )
    .toBe(2);
  expect(
    (
      await fixture.prisma.invitation.findUniqueOrThrow({
        where: { id: household.id },
      })
    ).openCount,
  ).toBe(0);
});
test("real OWNER reset and disable revoke staff sessions; first sign-in enforces password change", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext({
      baseURL: ADMIN_ORIGIN,
    }),
    staff = await context.newPage();
  try {
    await login(staff, fixture.staff.email);
    await login(page, fixture.owner.email);
    await page.goto("/settings/staff");
    await page
      .getByRole("button", {
        name: `Reset password for ${fixture.staff.email}`,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Confirm staff update" }).click();
    const credential = page.getByRole("region", {
      name: "Temporary credential",
    });
    await expect(credential).toBeVisible();
    const temporary = await credential.locator("code").innerText();
    expect((await context.request.get("/api/admin/auth/me")).status()).toBe(
      401,
    );
    await login(staff, fixture.staff.email, temporary, "/account/password");
    await expect(staff).toHaveURL(`${ADMIN_ORIGIN}/account/password`);
    await staff.getByLabel("Current password", { exact: true }).fill(temporary);
    await staff
      .getByLabel("New password", { exact: true })
      .fill("synthetic changed workflow password");
    await staff
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(staff).toHaveURL(`${ADMIN_ORIGIN}/checkin`);
    await page
      .getByRole("button", {
        name: `Disable ${fixture.staff.email}`,
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "Confirm staff update" }).click();
    await expect(
      page.getByRole("button", {
        name: `Activate ${fixture.staff.email}`,
        exact: true,
      }),
    ).toBeVisible();
    expect((await context.request.get("/api/admin/auth/me")).status()).toBe(
      401,
    );
    expect(
      (
        await fixture.prisma.adminUser.findUniqueOrThrow({
          where: { id: fixture.staff.id },
        })
      ).status,
    ).toBe("DISABLED");
  } finally {
    await context.close();
  }
});
