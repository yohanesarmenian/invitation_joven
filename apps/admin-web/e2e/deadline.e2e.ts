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
  for (const value of ["2027-06-01T18:30:45", "2027-06-01T18:30:45.678", ""]) {
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

test("incomplete native deadline date, hour and minute never send PATCH", async ({
  page,
}) => {
  await edit(page);
  const writes: Array<{ rsvpDeadlineAt: string | null }> = [];
  await page.route("**/api/admin/invitations/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes.push(route.request().postDataJSON());
    await route.fulfill({
      status: 400,
      json: { error: { code: "VALIDATION_ERROR" } },
    });
  });
  const deadline = page.getByLabel("RSVP deadline", { exact: true });
  const notes = page.getByLabel("Internal notes", { exact: true });
  const clear = page.getByRole("button", { name: "Clear RSVP deadline" });
  for (const width of [320, 375, 412, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const control of [deadline, clear]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
  }
  await notes.fill("Keep this draft during validation");
  for (const segment of [0, 3, 4]) {
    await deadline.fill("2027-06-01T18:30");
    for (let i = 0; i < 6; i++) await deadline.press("ArrowLeft");
    for (let i = 0; i < segment; i++) await deadline.press("ArrowRight");
    await deadline.press("Backspace");
    expect(
      await deadline.evaluate(
        (input: HTMLInputElement) =>
          input.validity.badInput && input.value === "",
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(deadline).toHaveAttribute("aria-invalid", "true");
    await expect(deadline).toBeFocused();
    await expect(notes).toHaveValue("Keep this draft during validation");
    await expect(page).toHaveURL(/\/edit$/);
    expect(writes).toHaveLength(0);
  }
  await clear.press("Enter");
  await expect(deadline).toHaveAttribute("aria-invalid", "false");
  expect(
    await deadline.evaluate(
      (input: HTMLInputElement) => input.validity.badInput,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("form", { name: "Edit invitation" }).getByRole("alert"),
  ).toContainText("not accepted");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.rsvpDeadlineAt).toBeNull();
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
    if (value) await deadline.fill(value);
    else
      await page.getByRole("button", { name: "Clear RSVP deadline" }).click();
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

test("typing into a cleared deadline blocks Save even without input or change events", async ({
  page,
}) => {
  await edit(page);
  const writes: Array<{ rsvpDeadlineAt: string | null }> = [];
  await page.route("**/api/admin/invitations/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes.push(route.request().postDataJSON());
    await route.fulfill({
      status: 400,
      json: { error: { code: "VALIDATION_ERROR" } },
    });
  });
  const deadline = page.getByLabel("RSVP deadline", { exact: true });
  const notes = page.getByLabel("Internal notes", { exact: true });
  const clear = page.getByRole("button", { name: "Clear RSVP deadline" });
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  for (const segment of [0, 3, 4]) {
    await clear.click();
    await deadline.evaluate((input) => {
      input.dataset.editEvents = "0";
      const count = () => {
        input.dataset.editEvents = String(Number(input.dataset.editEvents) + 1);
      };
      input.addEventListener("input", count, { once: true });
      input.addEventListener("change", count, { once: true });
    });
    for (let i = 0; i < 6; i++) await deadline.press("ArrowLeft");
    for (let i = 0; i < segment; i++) await deadline.press("ArrowRight");
    await deadline.press("1");
    // Blur and re-render the form through an unrelated field edit.
    await notes.fill(`Preserve notes from segment ${segment}`);
    expect(
      await deadline.evaluate((input: HTMLInputElement) => ({
        badInput: input.validity.badInput,
        value: input.value,
        editEvents: input.dataset.editEvents,
      })),
    ).toEqual({ badInput: true, value: "", editEvents: "0" });
    await expect(deadline).toHaveAttribute("aria-invalid", "false");
    await save.click();
    await expect(page.locator("#deadline-error")).toBeVisible();
    await expect(deadline).toHaveAttribute("aria-invalid", "true");
    await expect(deadline).toBeFocused();
    await expect(notes).toHaveValue(`Preserve notes from segment ${segment}`);
    await expect(page).toHaveURL(/\/edit$/);
    expect(writes).toHaveLength(0);
  }
  await clear.click();
  await deadline.fill("2027-06-02T00:15:45");
  await save.click();
  await expect(deadline).toHaveAttribute("aria-invalid", "true");
  expect(writes).toHaveLength(0);
  await deadline.fill("2027-06-02T00:15");
  const response = page.waitForResponse(
    (res) => res.request().method() === "PATCH",
  );
  await save.click();
  await response;
  expect(writes).toHaveLength(1);
  expect(writes[0]?.rsvpDeadlineAt).toBe("2027-06-01T17:15:00.000Z");
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
