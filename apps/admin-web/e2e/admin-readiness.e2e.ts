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
  await expect(page).toHaveURL("http://localhost:3001/");
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const control of await page
    .locator("main input:visible, main select:visible, main button:visible")
    .all()) {
    const box = await control.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
  }
}

for (const width of [320, 375, 412, 768, 1024, 1280, 1440]) {
  test(`create stays usable and the retired route returns to Dashboard at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.goto("/invitations/new");
    await page.locator("#invitee-0").fill("Sample Wedding Guest");
    await page
      .getByText("Greeting, additional guests, children and RSVP deadline", {
        exact: true,
      })
      .click();
    const date = page.getByLabel("Deadline date (WIB)", { exact: true });
    const time = page.getByLabel("Deadline time (WIB)", { exact: true });
    await expect(date).toHaveAttribute("type", "date");
    await expect(time).toHaveAttribute("type", "time");
    await expect(time).toHaveAttribute("step", "60");
    await date.fill("2027-01-02");
    await time.fill("00:30");
    await expect(
      page.getByRole("region", { name: "Review invitation" }),
    ).toContainText("2 Jan 2027, 00:30 WIB");
    const submit = page.getByRole("button", {
      name: "Create invitation",
      exact: true,
    });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    await noOverflow(page);

    await page.goto("/checkin");
    await expect(page).toHaveURL("http://localhost:3001/");
    await expect(page.getByLabel("Event", { exact: true })).toHaveCount(0);
  });
}

test("deadline requires both fields, supports keyboard focus and sends exact Jakarta minute without replay", async ({
  page,
}) => {
  await login(page);
  await page.goto("/invitations/new");
  await page.locator("#invitee-0").fill("Sample Deadline Guest");
  await page
    .getByText("Greeting, additional guests, children and RSVP deadline", {
      exact: true,
    })
    .click();
  const date = page.getByLabel("Deadline date (WIB)", { exact: true });
  const time = page.getByLabel("Deadline time (WIB)", { exact: true });
  let posts = 0;
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/admin/invitations", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      payload = route.request().postDataJSON();
      await route.fulfill({ status: 503, json: {} });
    } else await route.continue();
  });
  await date.fill("2027-01-02");
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(date).toBeFocused();
  await expect(page.locator("#deadline-error")).toBeVisible();
  expect(posts).toBe(0);
  await time.fill("00:30");
  await time.focus();
  await expect(time).toHaveCSS("outline-style", "solid");
  // Native time controls have separate hour/minute/period keyboard segments.
  for (let segment = 0; segment < 4; segment++) {
    await page.keyboard.press("Tab");
    if (
      await page
        .getByLabel("Internal notes")
        .evaluate((element) => element === document.activeElement)
    )
      break;
  }
  await expect(page.getByLabel("Internal notes")).toBeFocused();
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Check invitations list" }),
  ).toBeVisible();
  expect(payload?.rsvpDeadlineAt).toBe("2027-01-01T17:30:00.000Z");
  expect(posts).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Create invitation", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(1);
});

for (const zoom of [1.25, 2]) {
  test(`create and dashboard reflow under ${zoom * 100}% CSS zoom`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page);
    for (const path of ["/invitations/new", "/checkin"]) {
      await page.goto(path);
      await page.evaluate((value) => {
        document.documentElement.style.zoom = String(value);
      }, zoom);
      if (path.includes("invitations")) {
        await page
          .getByText(
            "Greeting, additional guests, children and RSVP deadline",
            { exact: true },
          )
          .click();
        await page
          .getByLabel("Deadline time (WIB)", { exact: true })
          .scrollIntoViewIfNeeded();
      } else
        await expect(
          page.getByRole("heading", { name: "Dashboard", exact: true }),
        ).toBeVisible();
      await noOverflow(page);
    }
  });
}
