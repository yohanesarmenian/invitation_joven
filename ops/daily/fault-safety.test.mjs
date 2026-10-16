import test from "node:test";
import assert from "node:assert/strict";
import { runRuntimeFaults } from "./runtime-fault-rehearsal.mjs";
import { runBackupFailures } from "./backup-failure-rehearsal.mjs";

for (const database of [
  "invitation_daily",
  "postgres",
  "invitation_qa_existing",
  "invitation_qa_daily_ABCD1234ABCD1234",
]) {
  test(`fault runners reject unowned database ${database} before allocating resources`, async () => {
    await assert.rejects(
      runRuntimeFaults({ qa: { database } }),
      /exact disposable QA identity/,
    );
    await assert.rejects(
      runBackupFailures({ qa: { database } }),
      /exact disposable QA identity/,
    );
  });
}
