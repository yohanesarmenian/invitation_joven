import { defineConfig, devices } from "@playwright/test";
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
    baseURL: "http://localhost:3001",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: [
    {
      command: "pnpm --filter api exec node dist/main.js",
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        PORT: "4000",
        ADMIN_ORIGIN: "http://localhost:3001",
        PUBLIC_INVITATION_BASE_URL: "http://localhost:3000",
      },
    },
    {
      command: "pnpm run dev",
      url: "http://localhost:3001/login",
      reuseExistingServer: false,
      stdout: "pipe",
      env: { ADMIN_API_INTERNAL_BASE_URL: "http://127.0.0.1:4000" },
    },
    {
      command: "pnpm --filter invitation-web dev",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      stdout: "pipe",
      env: { INVITATION_API_BASE_URL: "http://127.0.0.1:4000" },
    },
  ],
});
