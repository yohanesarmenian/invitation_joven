import { defineConfig, devices } from "@playwright/test";

// `localhost`, not `127.0.0.1`: Next dev blocks its own dev resources for
// cross-origin hosts, which leaves the page unhydrated and every click inert.
const APP_BASE_URL = "http://localhost:3000";
const MOCK_API_BASE_URL = "http://127.0.0.1:4010";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  // The mock request counter is shared harness state: keep the run serial.
  workers: 1,
  retries: 0,
  reporter: "list",
  expect: {
    // Next dev compiles the invitation route on first navigation.
    timeout: 15_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: APP_BASE_URL,
    screenshot: "off",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // cwd defaults to this config's directory (apps/invitation-web).
      command: "pnpm exec tsx e2e/mock-public-invitation-api.ts",
      url: `${MOCK_API_BASE_URL}/__health`,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "pnpm run dev",
      url: APP_BASE_URL,
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        INVITATION_API_BASE_URL: MOCK_API_BASE_URL,
        VENUE_CONTENT_PREVIEW: "1",
      },
    },
  ],
});
