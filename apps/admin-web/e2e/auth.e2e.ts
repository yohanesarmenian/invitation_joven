import { expect, test, type Page } from "@playwright/test";

const password = "synthetic test password 💐";
const ended = "Your admin session has ended. Please sign in again.";
let pageErrors: string[] = [];
let consoleErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
  // Chromium reports expected rejected/aborted HTTP requests; application errors
  // and hydration warnings must still fail every flow, including failure UX.
  expect(
    consoleErrors.filter(
      (message) => !message.startsWith("Failed to load resource:"),
    ),
  ).toEqual([]);
  expect(consoleErrors.some((message) => message.includes(password))).toBe(
    false,
  );
});
async function fill(page: Page, email = "owner@example.com", value = password) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(value);
}
async function login(page: Page, email = "owner@example.com") {
  await page.goto("/login");
  await fill(page, email);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("same-origin login, HttpOnly session, refresh, login redirect, logout and denied revisit", async ({
  page,
  context,
}) => {
  const requests: string[] = [];
  const messages: string[] = [];
  const errors: string[] = [];
  const privateValues: string[] = [password];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
  });
  page.on("console", (message) => messages.push(message.text()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/admin/auth/login", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    privateValues.push(body.csrfToken);
    expect("sessionToken" in body).toBe(false);
    await route.fulfill({ response });
  });
  await login(page, "  OWNER@Example.COM  ");
  await expect(
    page.getByText("owner@example.com", { exact: false }),
  ).toBeVisible();
  expect(page.url()).toBe("http://localhost:3001/");
  const cookie = (await context.cookies()).find(
    (item) => item.name === "admin_session",
  );
  expect(!!cookie).toBe(true);
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  expect(cookie?.path).toBe("/");
  expect(cookie?.secure).toBe(false);
  if (cookie) privateValues.push(cookie.value);
  expect(
    await page.evaluate(() => document.cookie.includes("admin_session")),
  ).toBe(false);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/login");
  await expect(page).toHaveURL("http://localhost:3001/");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/login");
  expect(
    (await context.cookies()).some((item) => item.name === "admin_session"),
  ).toBe(false);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(ended)).toBeVisible();
  expect(requests.length).toBeGreaterThanOrEqual(2);
  expect(
    requests.every((url) =>
      url.startsWith("http://localhost:3001/api/admin/auth/"),
    ),
  ).toBe(true);
  expect(
    privateValues.some((value) =>
      messages.some((message) => message.includes(value)),
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
  expect(messages.filter((message) => /error/i.test(message))).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});

test("direct unauthenticated response contains no protected shell or content", async ({
  request,
  page,
}) => {
  const response = await request.get("/", { maxRedirects: 0 });
  const html = await response.text();
  expect([307, 308]).toContain(response.status());
  // Dev RSC debug metadata can name DashboardPage; no rendered/payload content.
  expect(html.includes("Invitation management and reporting")).toBe(false);
  expect(html.includes("<h1>Dashboard</h1>")).toBe(false);
  expect(html.includes("Sign out")).toBe(false);
  await page.goto("/");
  await expect(page.getByText(ended)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
});

test("local validation makes no API request, focuses errors, handles code points and spaces", async ({
  page,
}) => {
  let count = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/login")) count++;
  });
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByText("Enter your password.")).toBeVisible();
  for (const email of ["bad", "x".repeat(249) + "@x.com"]) {
    await fill(page, email);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("Enter a valid email address of at most 254 characters."),
    ).toBeVisible();
  }
  for (const value of [
    "x".repeat(14),
    "x".repeat(129),
    "💐".repeat(14),
    "💐".repeat(129),
  ]) {
    await fill(page, "owner@example.com", value);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await expect(
      page.getByText("Use 15 to 128 characters, including spaces."),
    ).toBeVisible();
  }
  expect(count).toBe(0);
  await fill(page, "owner@example.com", " ".repeat(15));
  const posted = page.waitForRequest((request) =>
    request.url().endsWith("/auth/login"),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await posted).postDataJSON().password === " ".repeat(15)).toBe(true);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

for (const value of [
  "x".repeat(15),
  "x".repeat(128),
  "💐".repeat(15),
  "💐".repeat(128),
]) {
  test(`accepts password boundary ${[...value].length} ${value.startsWith("x") ? "ASCII" : "Unicode"}`, async ({
    page,
  }) => {
    await page.goto("/login");
    await fill(page, "owner@example.com", value);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
  });
}

for (const [email, message] of [
  ["unknown@example.com", "Email or password is incorrect."],
  ["disabled@example.com", "Email or password is incorrect."],
  ["wrong@example.com", "Email or password is incorrect."],
  [
    "throttled@example.com",
    "Too many sign-in attempts. Please try again later.",
  ],
  ["validation@example.com", "Check your email and password, then try again."],
  ["unexpected@example.com", "Unable to sign in. Please try again."],
] as const) {
  test(`safe login response ${email.split("@")[0]}`, async ({ page }) => {
    let count = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/auth/login")) count++;
    });
    await page.goto("/login");
    await fill(page, email);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(message!);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeEnabled();
    expect(count).toBe(1);
    expect(
      (await page.locator("body").innerText()).includes(
        "Private backend diagnostic",
      ),
    ).toBe(false);
  });
}

test("pending login synchronously blocks duplicate form submits", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  await page.route("**/api/admin/auth/login", async (route) => {
    count++;
    await held;
    await route.continue();
  });
  await page.goto("/login");
  await fill(page);
  await page.locator("form").evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect(
    page.getByRole("button", { name: "Signing in…" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Password", { exact: true })).toBeDisabled();
  expect(count).toBe(1);
  release();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("logout pending guard sends one request with CSRF", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  await page.route("**/api/admin/auth/logout", async (route) => {
    count++;
    expect(!!route.request().headers()["x-csrf-token"]).toBe(true);
    await held;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(
    page.getByRole("button", { name: "Signing out…" }),
  ).toBeDisabled();
  expect(count).toBe(1);
  release();
  await expect(page).toHaveURL("http://localhost:3001/login");
});

test("logout CSRF recovery reads once and waits for explicit retry", async ({
  page,
}) => {
  await login(page, "csrf@example.com");
  const methods: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/admin/auth/"))
      methods.push(request.method());
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Admin workspace" })
      .getByRole("status"),
  ).toContainText("Select Sign out again");
  expect(methods).toEqual(["POST", "GET"]);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL("http://localhost:3001/login");
  expect(methods).toEqual(["POST", "GET", "POST"]);
});

test("logout 401 shows generic session-ended notice and empty password", async ({
  page,
}) => {
  await login(page, "ended@example.com");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText(ended)).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  expect(page.url()).toBe("http://localhost:3001/login?session=ended");
});
test("forbidden logout stays in shell with authorization error", async ({
  page,
}) => {
  await login(page, "forbidden@example.com");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Admin workspace" })
      .getByRole("status"),
  ).toHaveText(
    "You are not authorized to perform this action.",
  );
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
test("malformed me never renders protected shell", async ({ page }) => {
  await page.goto("/login");
  await fill(page, "malformed@example.com");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Admin access unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
});
test("lost cookie on protected refresh ends session", async ({
  page,
  context,
}) => {
  await login(page);
  await context.clearCookies();
  await page.reload();
  await expect(page.getByText(ended)).toBeVisible();
});

test("network login failure is safe and never retries automatically", async ({
  page,
}) => {
  let count = 0;
  await page.route("**/api/admin/auth/login", async (route) => {
    count++;
    await route.abort("connectionfailed");
  });
  await page.goto("/login");
  await fill(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "Unable to sign in. Please try again.",
  );
  expect(count).toBe(1);
});
test("failed CSRF recovery requires reload without another logout POST", async ({
  page,
}) => {
  await login(page, "csrf@example.com");
  let count = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/auth/logout")) count++;
  });
  await page.route("**/api/admin/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reload page" })).toBeVisible();
  expect(count).toBe(1);
});
test("network logout failure keeps shell and requires an explicit retry", async ({
  page,
}) => {
  await login(page);
  let count = 0;
  await page.route("**/api/admin/auth/logout", async (route) => {
    count++;
    await route.abort("connectionfailed");
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page
      .getByRole("complementary", { name: "Admin workspace" })
      .getByRole("status"),
  ).toHaveText(
    "Unable to sign out. Please try again.",
  );
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  expect(count).toBe(1);
});

for (const width of [320, 375, 412, 768, 1280]) {
  test(`responsive keyboard login, error and shell at ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await noOverflow(page);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await noOverflow(page);
    await fill(page);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`shell-${width}.png`),
      fullPage: true,
      caret: "initial",
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`login-${width}.png`),
      fullPage: true,
      caret: "initial",
    });
  });
}
