import { expect, test, type Page } from "@playwright/test";

async function edit(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("list-owner@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await page.goto("/invitations");
  await page.getByRole("link", { name: "Household 01", exact: true }).click();
  await page
    .getByRole("link", { name: "Edit invitation", exact: true })
    .click();
}

test("non-minute deadline is rejected inline without sending a clearing PATCH", async ({
  page,
}) => {
  await edit(page);
  let writes = 0;
  await page.route("**/api/admin/invitations/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    await route.fulfill({
      status: 400,
      json: {
        error: { code: "VALIDATION_ERROR", message: "Synthetic rejection" },
      },
    });
  });
  const deadline = page.getByLabel("RSVP deadline", { exact: true });
  for (const value of ["2027-06-01T18:30:45", "2027-06-01T18:30:45.678"]) {
    await deadline.fill(value);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(deadline).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#deadline-error")).toBeVisible();
    await expect(deadline).toHaveValue(value);
    expect(writes).toBe(0);
  }
});

test("unrelated edits preserve precision and valid minute and explicit clear payloads remain distinct", async ({
  page,
}) => {
  await edit(page);
  const bodies: Array<{ rsvpDeadlineAt: string | null }> = [];
  await page.route("**/api/admin/invitations/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 409,
      json: { error: { code: "CONFLICT", message: "Synthetic conflict" } },
    });
  });
  await page
    .getByLabel("Internal notes", { exact: true })
    .fill("Synthetic deadline review");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("form", { name: "Edit invitation" }).getByRole("alert"),
  ).toContainText("changed elsewhere");
  expect(bodies[0]?.rsvpDeadlineAt).toBe("2026-12-25T16:59:59.000Z");
  const deadline = page.getByLabel("RSVP deadline", { exact: true });
  for (const [value, expected] of [
    ["2027-06-01T18:30", "2027-06-01T11:30:00.000Z"],
    ["", null],
  ] as const) {
    await deadline.fill(value);
    const pending = page.waitForResponse(
      (response) => response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await pending;
    expect(bodies.at(-1)!.rsvpDeadlineAt).toBe(expected);
    await expect(deadline).toHaveValue(value);
  }
});

test("known API failure preserves the draft and double submission sends one PATCH", async ({
  page,
}) => {
  await edit(page);
  const deadline = page.getByLabel("RSVP deadline", { exact: true });
  await deadline.fill("2027-06-01T18:30");
  await page
    .getByLabel("Internal notes", { exact: true })
    .fill("Keep this draft");
  let writes = 0;
  await page.route("**/api/admin/invitations/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    await route.fulfill({
      status: 400,
      json: {
        error: { code: "VALIDATION_ERROR", message: "Synthetic rejection" },
      },
    });
  });
  await page
    .getByRole("button", { name: "Save changes", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByRole("form", { name: "Edit invitation" }).getByRole("alert"),
  ).toContainText("not accepted");
  expect(writes).toBe(1);
  await expect(deadline).toHaveValue("2027-06-01T18:30");
  await expect(page.getByLabel("Internal notes", { exact: true })).toHaveValue(
    "Keep this draft",
  );
});
