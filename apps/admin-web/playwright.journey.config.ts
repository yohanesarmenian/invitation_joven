import { defineConfig, devices } from "@playwright/test";

// Dedicated ports/output directories preserve the owner's visual preview.
export default defineConfig({
  testDir: "./e2e-real",
  testMatch: [
    "**/checkin.e2e.ts",
    "**/event-content.e2e.ts",
    "**/invitation-journey.e2e.ts",
  ],
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3101",
    launchOptions: { args: ["--disable-gpu", "--renderer-process-limit=2"] },
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: [
    {
      command: "pnpm --filter api exec node dist/main.js",
      url: "http://127.0.0.1:4100/health",
      reuseExistingServer: false,
      env: {
        PORT: "4100",
        ADMIN_ORIGIN: "http://localhost:3101",
        PUBLIC_INVITATION_BASE_URL: "http://localhost:3100",
      },
    },
    {
      command: "pnpm exec next dev --port 3101",
      url: "http://localhost:3101/login",
      reuseExistingServer: false,
      env: {
        RAYON_NUM_THREADS: "2",
        NEXT_QA_DIST_DIR: ".next-journey",
        ADMIN_API_INTERNAL_BASE_URL: "http://127.0.0.1:4100",
      },
    },
    {
      command: "pnpm --filter invitation-web exec next dev --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: false,
      env: {
        RAYON_NUM_THREADS: "2",
        NEXT_QA_DIST_DIR: ".next-journey",
        INVITATION_API_BASE_URL: "http://127.0.0.1:4100",
      },
    },
  ],
});
