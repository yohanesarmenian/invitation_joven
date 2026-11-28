import { expect, test } from "@playwright/test";

test("retired venue workspaces redirect OWNER and no scanner is mounted", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("create-owner@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/");
  for (const path of ["/checkin", "/reception"]) {
    await page.goto(path);
    await expect(page).toHaveURL("http://localhost:3001/");
    await expect(page.locator("video input, video, canvas")).toHaveCount(0);
  }
  await expect(
    page.getByRole("link", { name: /open check-in|guest reception/i }),
  ).toHaveCount(0);
});
