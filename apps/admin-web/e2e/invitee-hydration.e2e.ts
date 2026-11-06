import { expect, test } from "@playwright/test";

test("invitee Edit cannot silently lose a click before detail hydration", async ({
  page,
}) => {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("invitee-hydration@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.goto("/invitations");
  const href = await page
    .getByRole("link", { name: "Household 01", exact: true })
    .getAttribute("href");
  let release!: () => void;
  const scripts = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/_next/static/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith(".js")) await scripts;
    await route.continue();
  });
  try {
    await page.goto(href!, { waitUntil: "commit" });
    await expect(
      page.getByRole("heading", { name: "Invitation detail", exact: true }),
    ).toBeVisible();
    const edit = page
      .getByRole("row", { name: /Sample guest Adult None/ })
      .getByRole("button", { name: "Edit", exact: true });
    const initiallyEnabled = await edit.isEnabled();
    const info = test.info();
    info.annotations.push({
      type: "before-hydration",
      description: initiallyEnabled
        ? "Edit enabled before handlers attached"
        : "Edit disabled until handlers attach",
    });
    if (initiallyEnabled) await edit.click();
    release();
    await page.waitForLoadState("load");
    if (!initiallyEnabled) await edit.click();
    await expect(
      page.getByRole("form", { name: "Edit invitee", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Full name (required)")).toHaveValue(
      "Sample guest",
    );
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});
