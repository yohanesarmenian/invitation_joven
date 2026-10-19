import { loadDailyConfig } from "./config.mjs";
import { createBackup } from "./backup.mjs";
const base = await loadDailyConfig();
const url = new URL(process.env.DATABASE_URL ?? "invalid:");
if (
  process.env.INVITATION_DAILY_VERIFICATION !== "1" ||
  !/^\/invitation_qa_daily_[a-f0-9]{16}$/.test(url.pathname)
)
  throw Error("Daily crash rehearsal requires an exact isolated QA database.");
await createBackup({
  ...base,
  database: url.pathname.slice(1),
  databaseUrl: url.toString(),
});
