import { defineConfig } from "@playwright/test";
import base from "./playwright.daily.config";
export default defineConfig({
  ...base,
  testMatch: ["**/event-management.e2e.ts"],
  outputDir: "../../.local-daily/events-browser-output",
});
