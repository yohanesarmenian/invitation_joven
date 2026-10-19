import { resolve, dirname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import { root, rootRequire } from "./config.mjs";
import { command } from "./database.mjs";
export async function runEventApiChecks({ env, record }) {
  const selected = [
    "src/events/event-management.http.integration.spec.ts",
    "src/admin/admin-mutation.http.integration.spec.ts",
    "src/admin/admin-invitee-eligibility.http.integration.spec.ts",
    "src/imports/guest-import.http.integration.spec.ts",
    "src/checkin/checkin.http.integration.spec.ts",
    "src/event-content/event-content.http.integration.spec.ts",
    "src/openapi.spec.ts",
  ];
  try {
    await command(
      process.execPath,
      [
        resolve(
          dirname(rootRequire.resolve("vitest/package.json")),
          "vitest.mjs",
        ),
        "run",
        "--no-file-parallelism",
        ...selected,
        "--reporter=json",
        `--outputFile=${resolve(root, ".local-daily/events-api-results.json")}`,
      ],
      { cwd: resolve(root, "apps/api"), env, timeout: 180000 },
    );
    const result = JSON.parse(
      await readFile(
        resolve(root, ".local-daily/events-api-results.json"),
        "utf8",
      ),
    );
    if (
      result.numFailedTests !== 0 ||
      !selected.every((file) =>
        result.testResults.some(
          (r) =>
            r.name.replaceAll("\\", "/").endsWith(file) &&
            r.status === "passed",
        ),
      ) ||
      result.numPassedTests < 8
    )
      throw Error("Required real database suites did not all pass");
    record(
      `events-real-PostgreSQL-and-affected-regressions-${result.numPassedTests}-tests`,
    );
  } catch (error) {
    await retainFailure(error);
  }
}
export async function runEventRehearsal({ env, record }) {
  try {
    const output = await command(
      process.execPath,
      [
        resolve(
          dirname(rootRequire.resolve("@playwright/test/package.json")),
          "cli.js",
        ),
        "test",
        "--config",
        "playwright.daily-events.config.ts",
        "--max-failures",
        "1",
      ],
      { cwd: resolve(root, "apps/admin-web"), env, timeout: 240000 },
    );
    if (!/\b4 passed\b/.test(stripVTControlCharacters(output)))
      throw Error("Expected four real event editor browser cases");
    record(
      "events-real-browser-create-edit-WIB-countdown-calendar-stale-lost-response-staff-4-cases",
    );
  } catch (error) {
    await retainFailure(error);
  }
}
async function retainFailure(error) {
  await writeFile(
    resolve(root, ".local-daily/events-failure.txt"),
    error.privateOutput ?? error.message,
  );
  throw error;
}
