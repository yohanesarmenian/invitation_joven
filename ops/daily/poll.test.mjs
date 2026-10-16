import test from "node:test";
import assert from "node:assert/strict";
import { poll } from "./poll.mjs";

test("poll returns the authoritative value when readiness arrives", async () => {
  let calls = 0;
  assert.deepEqual(
    await poll(
      async () => (++calls === 2 ? { ready: true } : false),
      100,
      "not ready",
      1,
    ),
    { ready: true },
  );
});
test("timed out polling owns no continuing timers or requests", async () => {
  let calls = 0;
  await assert.rejects(
    poll(
      async () => {
        calls++;
        return false;
      },
      10,
      "readiness timeout",
      1,
    ),
    /readiness timeout/,
  );
  const stopped = calls;
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(calls, stopped);
});
