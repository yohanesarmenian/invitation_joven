import { defineConfig } from "@playwright/test";
import journey from "./playwright.journey.config";

// Real API + disposable PostgreSQL only; no mock authentication or API server.
export default defineConfig(journey, {
  testMatch: "**/invitation-recovery.e2e.ts",
  outputDir: "../../.local-daily/p0-production-recovery-20261106/real-results",
  timeout: 120_000,
});
