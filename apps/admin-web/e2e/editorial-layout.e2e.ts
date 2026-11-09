import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("create-owner@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}

for (const width of [320, 375, 412, 768, 1280]) {
  test(`editorial workspace keeps primary tasks and guest identity usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    if (width <= 760) {
      expect(
        (await page.locator(".admin-sidebar").boundingBox())!.height,
      ).toBeLessThanOrEqual(96);
      const toggle = page.getByRole("button", { name: "Open navigation" });
      await toggle.click();
      for (const label of [
        "Dashboard",
        "Invitations",
        "RSVPs",
        "Messages",
        "Check-in",
        "Reports",
        "Events",
        "Event materials",
        "Staff",
        "Change password",
      ]) {
        await expect(
          page
            .getByRole("navigation", { name: "Primary navigation" })
            .getByRole("link", { name: label, exact: true }),
        ).toBeVisible();
      }
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
    }
    await page
      .getByRole("link", { name: "Create invitation", exact: true })
      .click();
    await expect(page.locator("#invitee-0")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove guest 1", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Invitation / household name (optional)"),
    ).toBeHidden();
    await page.locator("#invitee-0").fill("Sample Editorial Guest");
    await expect(
      page.getByRole("region", { name: "Review invitation" }),
    ).toContainText("Sample Editorial Guest");
    await page
      .getByRole("button", { name: "Create invitation", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "Create invitation", exact: true }),
    ).toBeInViewport();
    await page.goto("/invitations");
    await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(25);
    const row = page.getByRole("row").filter({
      has: page.getByRole("link", { name: "Household 01", exact: true }),
    });
    const identity = row.getByRole("rowheader");
    expect((await identity.boundingBox())!.width).toBeGreaterThan(
      width <= 1100 ? 150 : 120,
    );
    if (width <= 1100) {
      const region = page.getByRole("region", { name: "Invitations table" });
      expect(
        await region.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await expect(
        row.getByText("Manage invitation", { exact: false }),
      ).toBeVisible();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(row.getByRole("cell")).toHaveCount(6);
    const detailLink = row.getByRole("link", {
      name: "Household 01",
      exact: true,
    });
    await detailLink.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(detailLink).toBeFocused();
    await expect(detailLink).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Invitation detail", exact: true }),
    ).toBeVisible();
  });
}

test("destructive action labels remain legible on hover", async ({ page }) => {
  await login(page);
  await page.goto("/invitations");
  await page.getByRole("link", { name: "Household 01", exact: true }).click();
  const button = page.getByRole("button", {
    name: "Archive invitation",
    exact: true,
  });
  await button.hover();
  await expect(button).toHaveCSS("color", "rgb(127, 29, 29)");
  await expect(button).toHaveCSS("background-color", "rgb(248, 233, 228)");
});

test("text enlargement preserves optional fields, errors and keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await login(page);
  await page.goto("/invitations/new");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await page.getByText("Household name (optional)", { exact: true }).click();
  await page
    .getByLabel("Invitation / household name (optional)")
    .fill("Sample household with a deliberately long display name");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.locator("#invitee-0")).toBeFocused();
  await expect(page.locator("#invitee-0")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#invitee-0").fill("Sample Guest");
  await page
    .getByText("Greeting, additional guests, children and RSVP deadline", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("Maximum additional children", { exact: true })
    .fill("-1");
  await page
    .getByText("Greeting, additional guests, children and RSVP deadline", {
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(page.locator("#children")).toBeFocused();
  await expect(page.locator("#children-error")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
