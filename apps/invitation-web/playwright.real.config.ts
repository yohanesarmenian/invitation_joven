import { defineConfig, devices } from "@playwright/test";

// `localhost`, not `127.0.0.1`: Next dev blocks its own dev resources for
// cross-origin hosts, which leaves the page unhydrated and every click inert.
const APP_BASE_URL = "http://localhost:3000";

// Real compiled Nest API. Deliberately not the mock port (4010): this suite
// must never reach the mock server.
const REAL_API_BASE_URL = "http://127.0.0.1:4000";

export default defineConfig({
  testDir: "./e2e-real",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  globalSetup: "./e2e-real/global-setup.ts",
  globalTeardown: "./e2e-real/global-teardown.ts",
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: APP_BASE_URL,
    screenshot: "off",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Compiled artifact only. `pnpm --filter` puts the child in `apps/api`
      // so the package-local `.env` and `dist/` resolve as they do in prod.
      command: "pnpm --filter api exec node dist/main.js",
      url: `${REAL_API_BASE_URL}/health`,
      reuseExistingServer: false,
      stdout: "pipe",
      env: { PORT: "4000" },
    },
    {
      command: "pnpm run dev",
      url: APP_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      env: { INVITATION_API_BASE_URL: REAL_API_BASE_URL },
    },
  ],
});
