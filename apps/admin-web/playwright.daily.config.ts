import { defineConfig } from "@playwright/test";
import base from "./playwright.journey.config";

const database = new URL(process.env.DATABASE_URL ?? "invalid:");
if (
  process.env.INVITATION_DAILY_VERIFICATION !== "1" ||
  !/^\/invitation_qa_daily_[a-f0-9]{16}$/.test(database.pathname)
)
  throw new Error(
    "Daily browser verification requires its explicitly isolated QA database.",
  );
export default defineConfig({
  ...base,
  webServer: [],
  outputDir: "../../.local-daily/browser-output",
  use: { ...base.use, baseURL: process.env.ADMIN_ORIGIN },
});
