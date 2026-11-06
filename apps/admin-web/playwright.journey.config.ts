import { defineConfig, devices } from "@playwright/test";
import { configureRunnerOrigins } from "./e2e-real/origins";

const origins = configureRunnerOrigins();

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
    baseURL: origins.admin,
    launchOptions: { args: ["--disable-gpu", "--renderer-process-limit=2"] },
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: [
    {
      command: "pnpm --filter api exec node dist/main.js",
      url: `${origins.api}/health`,
      reuseExistingServer: false,
      env: {
        PORT: new URL(origins.api).port,
        ADMIN_ORIGIN: origins.admin,
        PUBLIC_INVITATION_BASE_URL: origins.invitation,
      },
    },
    {
      command: `pnpm exec next dev --port ${new URL(origins.admin).port}`,
      url: `${origins.admin}/login`,
      reuseExistingServer: false,
      env: {
        RAYON_NUM_THREADS: "2",
        NEXT_QA_DIST_DIR: ".next-journey",
        ADMIN_API_INTERNAL_BASE_URL: origins.api,
      },
    },
    {
      command: `pnpm --filter invitation-web exec next dev --port ${new URL(origins.invitation).port}`,
      url: origins.invitation,
      reuseExistingServer: false,
      env: {
        RAYON_NUM_THREADS: "2",
        NEXT_QA_DIST_DIR: ".next-journey",
        INVITATION_API_BASE_URL: origins.api,
      },
    },
  ],
});
