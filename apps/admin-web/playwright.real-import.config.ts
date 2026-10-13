import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-real",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: "list",
  expect: { timeout: 20_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://localhost:3001",
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "pnpm --dir ../api run dev",
      url: "http://127.0.0.1:4051/health",
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        ADMIN_ORIGIN: "http://localhost:3001",
        PORT: "4051",
      },
    },
    {
      command: "pnpm exec next dev --port 3001",
      url: "http://localhost:3001/login",
      reuseExistingServer: false,
      stdout: "pipe",
      env: { ADMIN_API_INTERNAL_BASE_URL: "http://127.0.0.1:4051" },
    },
  ],
});
