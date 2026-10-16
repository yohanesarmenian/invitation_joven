import { defineConfig } from "@playwright/test";
import base from "./playwright.daily.config";

export default defineConfig({
  ...base,
  testMatch: ["**/import-real.e2e.ts"],
  outputDir: "../../.local-daily/import-browser-output",
});
