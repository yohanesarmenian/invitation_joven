import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: "list",
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3001",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "pnpm exec tsx e2e/mock-auth-api.ts",
      url: "http://127.0.0.1:4011/api/admin/auth/me",
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "pnpm run dev",
      url: "http://localhost:3001/login",
      reuseExistingServer: false,
      stdout: "pipe",
      env: { ADMIN_API_INTERNAL_BASE_URL: "http://127.0.0.1:4011" },
    },
  ],
});
