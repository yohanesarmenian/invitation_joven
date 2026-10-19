import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import {
  parseDailyConfig,
  parseDailyConfigSource,
  dailyEnvironment,
  redactDailyOutput,
} from "./config.mjs";

function sample() {
  return {
    DAILY_PROFILE_ID: randomUUID(),
    DAILY_DATABASE_PASSWORD: randomBytes(32).toString("hex"),
    DAILY_OPERATOR_PASSWORD: randomBytes(32).toString("hex"),
    CREDENTIAL_SECRET: randomBytes(32).toString("base64url"),
    DAILY_PG_PORT: "55433",
    DAILY_PUBLIC_PORT: "3200",
    DAILY_ADMIN_PORT: "3201",
    DAILY_API_PORT: "4200",
    DAILY_CONTROL_PORT: "4201",
  };
}
test("daily config owns immutable target names and derives all origins from ports", () => {
  const config = parseDailyConfig(sample());
  assert.equal(config.database, "invitation_daily");
  assert.equal(config.role, "invitation_daily_app");
  assert.equal(config.publicOrigin, "http://localhost:3200");
  assert.equal(new URL(config.databaseUrl).hostname, "127.0.0.1");
});
for (const [key, value] of [
  ["DATABASE_URL", "postgresql://unrelated"],
  ["DAILY_PROFILE_ID", "invalid"],
  ["CREDENTIAL_SECRET", "placeholder"],
  ["DAILY_DATABASE_PASSWORD", "default-password"],
  ["DAILY_PUBLIC_PORT", "0"],
  ["DAILY_PUBLIC_PORT", "65536"],
  ["DAILY_PUBLIC_PORT", "3200suffix"],
  ["DAILY_PUBLIC_PORT", "3201"],
  ["DAILY_API_HOST", "192.168.1.2"],
])
  test(`config rejects malformed or unsupported ${key} input`, () =>
    assert.throws(() => parseDailyConfig({ ...sample(), [key]: value })));
test("duplicate declarations fail instead of selecting a last secret", () => {
  const input = sample(),
    source = Object.entries(input)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
  assert.throws(() =>
    parseDailyConfigSource(source + "\nDAILY_PUBLIC_PORT=3300\n"),
  );
});
test("source size is bounded before parse", () =>
  assert.throws(() => parseDailyConfigSource("x".repeat(8193))));
test("daily child environment cannot re-enable QA fixture flags or inherit bootstrap values", () => {
  const config = parseDailyConfig(sample()),
    env = dailyEnvironment(config, {
      INVITATION_DATABASE_TESTS: "1",
      INVITATION_WORKFLOW_TEST: "1",
      ADMIN_BOOTSTRAP_PASSWORD: "synthetic",
      VENUE_CONTENT_PREVIEW: "1",
      NODE_ENV: "production",
    });
  assert.equal(env.INVITATION_DATABASE_TESTS, "0");
  assert.equal(env.INVITATION_WORKFLOW_TEST, "0");
  assert.equal(env.ADMIN_BOOTSTRAP_PASSWORD, "");
  assert.equal(env.API_HOST, "127.0.0.1");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.NEXT_DIST_DIR, ".next-daily");
});
test("only configured sensitive values are redacted without dumping ambient environment", () => {
  const config = parseDailyConfig(sample());
  const output = redactDailyOutput(
    [
      config.databaseUrl,
      config.operatorUrl,
      config.secret,
      config.databasePassword,
      config.operatorPassword,
      "visible",
    ].join(" "),
    config,
  );
  assert.equal(
    output,
    "[redacted] [redacted] [redacted] [redacted] [redacted] visible",
  );
});
