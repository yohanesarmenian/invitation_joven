import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("migration gate rejects runtime/admin roles and malformed URLs without credential output", () => {
  const secret = "synthetic-credential-canary-never-production";
  for (const url of [
    `postgresql://invitation_app:${secret}@127.0.0.1:9/qa_gate`,
    `postgresql://postgres:${secret}@127.0.0.1:9/qa_gate`,
    `not-a-url-${secret}`,
  ]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./migrate.mjs", import.meta.url))],
      {
        env: { ...process.env, DATABASE_URL: url },
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Migration gate failed; rollout blocked/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(url));
    assert.doesNotMatch(result.stdout, /Prisma migrate deploy succeeded/);
  }
});
