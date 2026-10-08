import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { preview, receipt } from "../tests/import-fixtures";
import { BASE_HEADERS } from "../src/imports/template";

const validatePath = "**/api/admin/imports/guest/validate";
const commitPath = "**/api/admin/imports/guest/commit";
const fixture = "e2e/fixtures/import.csv";
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
const error = (route: Route, code: string, status: number) =>
  json(
    route,
    { error: { code, message: "Private diagnostic", details: null } },
    status,
  );
async function login(page: Page) {
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("import-owner@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}
async function open(page: Page) {
  await login(page);
  await page.goto("/invitations/import");
  await expect(
    page.getByRole("heading", { name: "Import CSV/XLSX", exact: true }),
  ).toBeVisible();
}
async function validate(page: Page) {
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page
    .getByRole("button", { name: "Validate file", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Household preview" }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "Review import" }).click();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
test.beforeEach(async ({ page }) => {
  page.on("pageerror", () => {
    throw new Error("Unexpected browser error");
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      throw new Error("Unexpected browser console error");
  });
  await page.route(validatePath, (route) => json(route, preview, 201));
  await page.route(commitPath, (route) => json(route, receipt));
});
test("complete workflow, actual download and multipart wire request, exact selected payload", async ({
  page,
}) => {
  await login(page);
  await page.goto("/invitations");
  await page.getByRole("link", { name: "Import CSV/XLSX" }).click();
  // Next's development tooling may own an IndexedDB database already.
  const databasesBefore = await page.evaluate(async () =>
    (await indexedDB.databases()).map((db) => db.name),
  );
  await expect(page.locator('nav a[aria-current="page"]')).toHaveText(
    "Invitations",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV template" }).click();
  const result = await download;
  expect(result.suggestedFilename()).toBe("invitation-import-template.csv");
  const csv = await readFile((await result.path())!, "utf8");
  expect(csv.startsWith(BASE_HEADERS.join(","))).toBe(true);
  expect(csv.trim().split(/\r?\n/)).toHaveLength(1);
  expect(csv).toContain("event:");
  await page.unroute(validatePath);
  const verifiedUpload = page.waitForResponse((r) =>
    r.url().endsWith("/imports/guest/validate"),
  );
  const upload = page.waitForRequest((r) =>
    r.url().endsWith("/imports/guest/validate"),
  );
  await validate(page);
  const request = await upload;
  const headers = await request.allHeaders();
  expect(request.method()).toBe("POST");
  expect(headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  expect(headers["x-csrf-token"]).toBeTruthy();
  expect(headers.cookie).toContain("admin_session=");
  // The mock HTTP receiver checks exact file bytes: Playwright's CDP request
  // inspection intentionally omits binary file contents from postDataBuffer.
  const uploadResponse = await verifiedUpload;
  expect(uploadResponse.status()).toBe(201);
  expect(uploadResponse.headers()["x-test-multipart-verified"]).toBe("true");
  await expect(page.getByText("2027-01-16 18:30")).toBeVisible();
  await expect(page.getByText("ceremony, reception")).toBeVisible();
  await page.getByText("Invitees (2) — row 2", { exact: true }).click();
  await expect(page.getByText("Example Adult · ADULT · Parent")).toBeVisible();
  await expect(page.getByText("Example Child · CHILD")).toBeVisible();
  await expect(page.getByLabel("Select row 5", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Select row 8", { exact: true })).toBeDisabled();
  await page.getByLabel("I acknowledge warnings for row 5").check();
  await page.getByLabel("Select row 5", { exact: true }).check();
  await page.getByLabel("I acknowledge warnings for row 5").uncheck();
  await expect(
    page.getByLabel("Select row 5", { exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("I acknowledge warnings for row 5").check();
  await page.getByLabel("Select row 5", { exact: true }).check();
  const posts: string[] = [];
  await page.route(commitPath, async (route) => {
    posts.push(route.request().postData()!);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await json(route, receipt);
  });
  await page.getByRole("button", { name: "Review import" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "2 household(s) selected. 1 warning row(s) acknowledged.",
  );
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .dblclick();
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0]!)).toEqual({
    previewId: preview.previewId,
    includeRowNumbers: [2, 5],
    acknowledgedWarningRowNumbers: [5],
  });
  await expect(page.getByText(receipt.importBatch.id)).toBeVisible();
  await expect(page.getByText("COMMITTED", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    ),
  ).toEqual(databasesBefore);
  await page.getByRole("link", { name: "View invitations" }).click();
  await expect(
    page.getByRole("heading", { name: "Invitations", exact: true, level: 1 }),
  ).toBeVisible();
});
for (const mode of ["network", "500", "malformed"] as const)
  test(`${mode} uncertainty freezes selection and replays exact request explicitly`, async ({
    page,
  }) => {
    const bodies: string[] = [];
    await page.route(commitPath, async (route) => {
      bodies.push(route.request().postData()!);
      if (bodies.length > 1) return json(route, receipt);
      if (mode === "network") return route.abort("failed");
      return json(route, {}, mode === "500" ? 500 : 200);
    });
    await open(page);
    await validate(page);
    await confirm(page);
    await expect(
      page.getByRole("heading", { name: "Import outcome not confirmed" }),
    ).toBeVisible();
    expect(bodies).toHaveLength(1);
    await expect(page.locator('input[type="file"]')).toBeDisabled();
    await expect(
      page.getByLabel("Select row 2", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Start new import" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Check import result" }).dblclick();
    await expect(
      page.getByRole("heading", { name: "Import complete" }),
    ).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });
for (const code of [
  "IMPORT_PREVIEW_STALE",
  "IMPORT_PREVIEW_EXPIRED",
  "IMPORT_PREVIEW_ALREADY_COMMITTED",
])
  test(`${code} requires a fresh explicit preview`, async ({ page }) => {
    let uploads = 0;
    await page.route(validatePath, (route) => {
      uploads++;
      return json(route, preview, 201);
    });
    await page.route(commitPath, (route) => error(route, code, 409));
    await open(page);
    await validate(page);
    await confirm(page);
    await expect(page.locator(".import-outcome [role=alert]")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Household preview" }),
    ).toHaveCount(0);
    expect(uploads).toBe(1);
    await page.getByRole("button", { name: "Validate file again" }).click();
    await expect(
      page.getByRole("heading", { name: "Household preview" }),
    ).toBeVisible();
    expect(uploads).toBe(2);
  });
for (const operation of ["validate", "commit"] as const)
  test(`${operation} CSRF refresh without POST replay and explicit retry`, async ({
    page,
  }) => {
    let posts = 0,
      reads = 0;
    const path = operation === "validate" ? validatePath : commitPath;
    await page.route(path, (route) => {
      posts++;
      return posts === 1
        ? error(route, "CSRF_INVALID", 403)
        : json(
            route,
            operation === "validate" ? preview : receipt,
            operation === "validate" ? 201 : 200,
          );
    });
    await open(page);
    page.on("request", (r) => {
      if (r.url().endsWith("/auth/me")) reads++;
    });
    if (operation === "validate") {
      await page.locator('input[type="file"]').setInputFiles(fixture);
      await page
        .getByRole("button", { name: "Validate file", exact: true })
        .click();
    } else {
      await validate(page);
      await confirm(page);
    }
    await expect(page.getByText(/Your session was refreshed/)).toBeVisible();
    expect(posts).toBe(1);
    expect(reads).toBe(1);
    if (operation === "validate") {
      await page.getByRole("button", { name: "Validate file again" }).click();
      await expect(
        page.getByRole("heading", { name: "Household preview" }),
      ).toBeVisible();
    } else {
      await confirm(page);
      await expect(
        page.getByRole("heading", { name: "Import complete" }),
      ).toBeVisible();
    }
    expect(posts).toBe(2);
  });
test("CSRF rejection during uncertain recovery retains original request and frozen controls", async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route(commitPath, (route) => {
    bodies.push(route.request().postData()!);
    return bodies.length === 1
      ? route.abort()
      : bodies.length === 2
        ? error(route, "CSRF_INVALID", 403)
        : json(route, receipt);
  });
  await open(page);
  await validate(page);
  await confirm(page);
  await page.getByRole("button", { name: "Check import result" }).click();
  await expect(page.getByText(/Your session was refreshed/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  expect(bodies).toHaveLength(2);
  await page.getByRole("button", { name: "Check import result" }).click();
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  expect(new Set(bodies).size).toBe(1);
});
test("file policy, replacement reset, validate rejection and double validation", async ({
  page,
}) => {
  await open(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "bad.xls",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("bad"),
  });
  await expect(page.getByText("Choose a .csv or .xlsx file.")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(5242881),
  });
  await expect(
    page.getByText("The file exceeds the 5 MiB limit."),
  ).toBeVisible();
  let posts = 0;
  await page.route(validatePath, async (route) => {
    posts++;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return posts === 1
      ? error(route, "VALIDATION_ERROR", 400)
      : json(route, preview, 201);
  });
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page
    .getByRole("button", { name: "Validate file", exact: true })
    .dblclick();
  await expect(page.getByText(/Validation was rejected/)).toBeVisible();
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "Validate file again" }).click();
  await expect(
    page.getByRole("heading", { name: "Household preview" }),
  ).toBeVisible();
  await page.getByLabel("I acknowledge warnings for row 5").check();
  await page.getByLabel("Select row 5", { exact: true }).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "replacement.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("synthetic mock bytes"),
  });
  await expect(
    page.getByRole("heading", { name: "Household preview" }),
  ).toHaveCount(0);
  expect(posts).toBe(2);
  await page
    .getByRole("button", { name: "Validate file", exact: true })
    .click();
  await expect(
    page.getByLabel("I acknowledge warnings for row 5"),
  ).not.toBeChecked();
});
for (const operation of ["validate", "commit"] as const)
  test(`${operation} session expiry uses existing session-ended login`, async ({
    page,
  }) => {
    await page.route(
      operation === "validate" ? validatePath : commitPath,
      async (route) => {
        await page.context().clearCookies();
        return error(route, "UNAUTHENTICATED", 401);
      },
    );
    await open(page);
    if (operation === "validate") {
      await page.locator('input[type="file"]').setInputFiles(fixture);
      await page
        .getByRole("button", { name: "Validate file", exact: true })
        .click();
    } else {
      await validate(page);
      await confirm(page);
    }
    await expect(page).toHaveURL(/login\?session=ended/);
    await expect(
      page.getByText("Your admin session has ended. Please sign in again."),
    ).toBeVisible();
  });
test("protected route, logout and protected revisit", async ({ page }) => {
  await page.goto("/invitations/import");
  await expect(page).toHaveURL(/\/login(?:\?session=ended)?$/);
  await open(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?session=ended)?$/);
  await page.goto("/invitations/import");
  await expect(page).toHaveURL(/\/login(?:\?session=ended)?$/);
  await expect(
    page.getByRole("heading", { name: "Household preview" }),
  ).toHaveCount(0);
});
test("500 households retain independent selection and last-row keyboard details", async ({
  page,
}) => {
  const rows = Array.from({ length: 500 }, (_, i) => ({
    ...preview.rows[0]!,
    rowNumber: i + 2,
  }));
  await page.route(validatePath, (route) =>
    json(
      route,
      {
        ...preview,
        rows,
        summary: {
          totalRows: 500,
          validRows: 500,
          warningRows: 0,
          errorRows: 0,
        },
      },
      201,
    ),
  );
  await open(page);
  await validate(page);
  await expect(page.locator(".import-row")).toHaveCount(500);
  await page.getByLabel("Select row 501", { exact: true }).uncheck();
  await expect(
    page.getByText("499 household(s) selected.", { exact: true }),
  ).toBeVisible();
  await page.getByText("Invitees (2) — row 501", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator(".import-row").last().getByText("Example Child · CHILD"),
  ).toBeVisible();
});
for (const width of [320, 375, 412, 768, 1280])
  test(`responsive ${width}: template, preview, keyboard dialog, uncertainty and receipt`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let attempts = 0;
    await page.route(commitPath, (route) =>
      ++attempts === 1 ? route.abort() : json(route, receipt),
    );
    await open(page);
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("idle.png"),
      fullPage: true,
      caret: "initial",
    });
    await page
      .getByText("File format and column guidance", { exact: true })
      .click();
    await noOverflow(page);
    await validate(page);
    await page.getByLabel("I acknowledge warnings for row 5").check();
    await page.getByLabel("Select row 5", { exact: true }).check();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("preview.png"),
      fullPage: true,
      caret: "initial",
    });
    await page.getByRole("button", { name: "Review import" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("confirmation.png"),
      caret: "initial",
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Review import" }),
    ).toBeFocused();
    await confirm(page);
    await expect(
      page.getByRole("heading", { name: "Import outcome not confirmed" }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("uncertain.png"),
      fullPage: true,
      caret: "initial",
    });
    await page.getByRole("button", { name: "Check import result" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Import complete" }),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("success.png"),
      fullPage: true,
      caret: "initial",
    });
  });

test("malformed and unavailable previews remain explicit revalidation failures", async ({
  page,
}) => {
  await open(page);
  for (const mode of ["malformed", "network"]) {
    await page.route(validatePath, (route) =>
      mode === "network"
        ? route.abort()
        : json(route, { ...preview, rows: [{}] }, 201),
    );
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByRole("button", { name: /^Validate file/ }).click();
    await expect(page.locator(".import-outcome [role=alert]")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Household preview" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Validate file again" }),
    ).toBeEnabled();
  }
});
test("known expired preview cannot commit and permits explicit validation", async ({
  page,
}) => {
  await page.route(validatePath, (route) =>
    json(route, { ...preview, expiresAt: "2000-01-01T00:00:00.000Z" }, 201),
  );
  await open(page);
  await validate(page);
  await expect(
    page.getByText("This preview has expired. Validate the file again."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review import" }),
  ).toBeDisabled();
});
test("definite commit validation rejection preserves row choices", async ({
  page,
}) => {
  await page.route(commitPath, (route) =>
    error(route, "VALIDATION_ERROR", 400),
  );
  await open(page);
  await validate(page);
  await page.getByLabel("I acknowledge warnings for row 5").check();
  await page.getByLabel("Select row 5", { exact: true }).check();
  await confirm(page);
  await expect(page.getByText(/Validation was rejected/)).toBeVisible();
  await expect(page.getByLabel("Select row 5", { exact: true })).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Review import" }),
  ).toBeEnabled();
});
test("forbidden recovery and failed CSRF refresh retain the uncertain payload", async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route(commitPath, (route) => {
    bodies.push(route.request().postData()!);
    return bodies.length === 1
      ? route.abort()
      : bodies.length === 2
        ? error(route, "FORBIDDEN", 403)
        : bodies.length === 3
          ? error(route, "CSRF_INVALID", 403)
          : json(route, receipt);
  });
  await open(page);
  await validate(page);
  await confirm(page);
  await page.getByRole("button", { name: "Check import result" }).click();
  await expect(
    page.getByText("You are not authorized to perform this action."),
  ).toBeVisible();
  await page.route("**/api/admin/auth/me", (route) => route.abort());
  await page.getByRole("button", { name: "Check import result" }).click();
  await expect(page.getByText(/Unable to refresh your session/)).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeDisabled();
  expect(bodies).toHaveLength(3);
  await page.getByRole("button", { name: "Check import result" }).click();
  await expect(
    page.getByRole("heading", { name: "Import complete" }),
  ).toBeVisible();
  expect(new Set(bodies).size).toBe(1);
});
