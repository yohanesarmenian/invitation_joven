import { defineConfig, devices } from "@playwright/test";
process.env.INVITATION_MOCK_API_BASE_URL = "http://127.0.0.1:4110";

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "**/public-design.e2e.ts",
    "**/public-enhancements.e2e.ts",
    "**/public-performance.e2e.ts",
    "**/public-invitation-flow.e2e.ts",
    "**/public-rsvp.e2e.ts",
    "**/public-guest-message.e2e.ts",
  ],
  metadata: { performanceMode: "built-local" },
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3110",
    screenshot: "off",
    trace: "off",
    video: "off",
    launchOptions: { args: ["--disable-gpu", "--renderer-process-limit=2"] },
  },
  webServer: [
    {
      command: "pnpm exec tsx e2e/mock-public-invitation-api.ts",
      url: "http://127.0.0.1:4110/__health",
      reuseExistingServer: false,
      env: { INVITATION_MOCK_API_PORT: "4110" },
    },
    {
      command: "pnpm exec next start --hostname 127.0.0.1 --port 3110",
      url: "http://localhost:3110",
      reuseExistingServer: false,
      env: {
        NEXT_QA_DIST_DIR: ".next-journey",
        INVITATION_API_BASE_URL: "http://127.0.0.1:4110",
        VENUE_CONTENT_PREVIEW: "1",
      },
    },
  ],
});
