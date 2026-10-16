import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  metadata: { venuePublished: true },
  testMatch: "**/venue-content.e2e.ts",
  webServer: [
    {
      command: "pnpm exec tsx e2e/mock-public-invitation-api.ts",
      env: {
        VENUE_CONTENT_DIRECTORY: resolve(__dirname, "e2e/fixtures/venue"),
      },
      url: "http://127.0.0.1:4010/__health",
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "pnpm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        INVITATION_API_BASE_URL: "http://127.0.0.1:4010",
        VENUE_CONTENT_PREVIEW: "1",
        VENUE_CONTENT_DIRECTORY: resolve(__dirname, "e2e/fixtures/venue"),
      },
    },
  ],
});
