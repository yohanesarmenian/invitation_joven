import { defineConfig, devices } from "@playwright/test";
import { configureRunnerOrigins } from "./e2e-real/origins";

const origins = configureRunnerOrigins({
  admin: "http://localhost:3001",
  api: "http://127.0.0.1:4000",
  invitation: "http://localhost:3000",
});
export default defineConfig({
  testDir: "./e2e-real",
  testMatch: ["**/checkin.e2e.ts", "**/event-content.e2e.ts"],
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: origins.admin,
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: [
    {
      command: "pnpm --filter api exec node dist/main.js",
      url: `${origins.api}/health`,
      reuseExistingServer: false,
      stdout: "pipe",
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
      stdout: "pipe",
      env: { ADMIN_API_INTERNAL_BASE_URL: origins.api },
    },
    {
      command: `pnpm --filter invitation-web exec next dev --port ${new URL(origins.invitation).port}`,
      url: origins.invitation,
      reuseExistingServer: false,
      stdout: "pipe",
      env: { INVITATION_API_BASE_URL: origins.api },
    },
  ],
});
