import { expect, test, type Page } from "@playwright/test";
test.use({ screenshot: "off", trace: "off" });
async function login(page: Page, email = "owner@example.com") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL("http://localhost:3001/login");
}
test("OWNER creates, disables, activates and resets staff with one-time credentials", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings/staff");
  await page.getByLabel("Staff email").fill("venue-operator@example.com");
  await page
    .getByRole("button", { name: "Create staff account", exact: true })
    .click();
  const secret = page.getByRole("region", { name: "Temporary credential" });
  await expect(secret).toContainText("synthetic temporary password");
  await page
    .getByRole("button", { name: "Dismiss temporary password" })
    .click();
  await expect(secret).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Disable venue-operator@example.com",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Confirm staff update" }).click();
  await expect(
    page.getByRole("button", {
      name: "Activate venue-operator@example.com",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Activate venue-operator@example.com",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Confirm staff update" }).click();
  await page
    .getByRole("button", {
      name: "Reset password for venue-operator@example.com",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Confirm staff update" }).click();
  await expect(secret).toContainText("synthetic replacement password");
  await page.reload();
  await expect(secret).toHaveCount(0);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});
test("uncertain create is not retried and must be reviewed", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings/staff");
  let writes = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname === "/api/admin/staff"
    )
      writes++;
  });
  await page
    .getByLabel("Staff email")
    .fill("lost-response-operator@example.com");
  await page
    .getByRole("button", { name: "Create staff account", exact: true })
    .click();
  await expect(page.getByText(/The update outcome is unknown/)).toBeVisible();
  expect(writes).toBe(1);
  await page
    .getByRole("button", { name: "Review current staff state" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "lost-response-operator@example.com",
      exact: true,
    }),
  ).toBeVisible();
  expect(writes).toBe(1);
});
test("staff never receives staff-management HTML or fetches the list", async ({
  page,
}) => {
  await login(page, "staff@example.com");
  let requests = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/admin/staff")) requests++;
  });
  await page.goto("/settings/staff");
  await expect(page).toHaveURL("http://localhost:3001/checkin");
  await expect(
    page.getByRole("heading", { name: "Check-in staff", exact: true }),
  ).toHaveCount(0);
  expect(requests).toBe(0);
});
