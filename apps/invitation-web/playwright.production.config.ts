import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  metadata: { performanceMode: "built-local" },
  testMatch: [
    "**/public-enhancements.e2e.ts",
    "**/public-invitation-flow.e2e.ts",
    "**/public-performance.e2e.ts",
    "**/public-design.e2e.ts",
    "**/venue-content.e2e.ts",
  ],
  webServer: [
    {
      command: "pnpm exec tsx e2e/mock-public-invitation-api.ts",
      url: "http://127.0.0.1:4010/__health",
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "pnpm start",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        INVITATION_API_BASE_URL: "http://127.0.0.1:4010",
        VENUE_CONTENT_PREVIEW: "1",
      },
    },
  ],
});
