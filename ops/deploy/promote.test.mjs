import test from "node:test";
import assert from "node:assert/strict";
import { promote } from "./promote.mjs";

const sha = "a".repeat(40),
  older = "b".repeat(40);
const options = {
  repository: "owner/repository",
  token: "synthetic-token",
  sha,
  environment: "staging",
};
const ref = (branch, value = sha) => ({
  ref: `refs/heads/${branch}`,
  object: { type: "commit", sha: value },
});
const run = {
  id: 123,
  head_sha: sha,
  head_branch: "master",
  event: "push",
  status: "completed",
  conclusion: "success",
  head_repository: { full_name: options.repository },
};
const comparison = { base_commit: { sha }, status: "identical" };
function transport(steps) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      const step = steps[calls.length];
      calls.push({ url, ...init });
      assert.ok(step, "Unexpected extra request");
      assert.equal(new URL(url).hostname, "api.github.com");
      assert.equal(init.redirect, "error");
      if (step instanceof Error) throw step;
      return new Response(JSON.stringify(step.body ?? step), {
        status: step.code ?? 200,
      });
    },
  };
}
const prefix = () => [ref("master"), comparison, { workflow_runs: [run] }];

test("invalid SHA or target cannot send any request", async () => {
  const api = transport([]);
  for (const change of [
    { sha: "master;unsafe" },
    { environment: "master" },
    { repository: "https://evil.test/x" },
  ]) {
    await assert.rejects(
      promote({ ...options, ...api, ...change }),
      /Invalid promotion/,
    );
  }
  assert.equal(api.calls.length, 0);
});
test("latest successful CI must match SHA, push, master and repository", async () => {
  for (const change of [
    { conclusion: "failure" },
    { status: "in_progress" },
    { head_sha: older },
    { event: "pull_request" },
    { head_branch: "other" },
    { head_repository: { full_name: "foreign/repository" } },
  ]) {
    const api = transport([
      ref("master"),
      comparison,
      { workflow_runs: [{ ...run, ...change }] },
    ]);
    await assert.rejects(
      promote({ ...options, ...api }),
      /latest master-push CI/,
    );
    assert.ok(api.calls.every((call) => call.method === "GET"));
  }
});
test("non-ancestor release cannot mutate a branch", async () => {
  const api = transport([
    ref("master"),
    { base_commit: { sha: older }, status: "diverged" },
  ]);
  await assert.rejects(promote({ ...options, ...api }), /not an ancestor/);
  assert.equal(api.calls.length, 2);
});
test("automatic staging ignores a stale completed run", async () => {
  const api = transport([ref("master", older)]);
  assert.equal(
    (await promote({ ...options, ...api, automatic: true })).status,
    "SKIPPED_STALE_AUTO_PROMOTION",
  );
  assert.equal(api.calls.length, 1);
});
test("automatic staging rechecks master immediately before mutation", async () => {
  const api = transport([
    ...prefix(),
    ref("deploy/staging", older),
    ref("master", older),
  ]);
  assert.equal(
    (await promote({ ...options, ...api, automatic: true })).status,
    "SKIPPED_STALE_AUTO_PROMOTION",
  );
  assert.ok(api.calls.every((call) => call.method === "GET"));
});
test("existing identical release causes no mutation and no redeploy claim", async () => {
  const api = transport([...prefix(), ref("deploy/staging")]);
  assert.equal(
    (await promote({ ...options, ...api })).status,
    "ALREADY_SELECTED_NO_NEW_WEBHOOK",
  );
  assert.ok(api.calls.every((call) => call.method === "GET"));
});
test("missing release is created exactly once then read authoritatively", async () => {
  const api = transport([
    ...prefix(),
    { code: 404 },
    ref("deploy/staging"),
    ref("deploy/staging"),
  ]);
  assert.equal((await promote({ ...options, ...api })).status, "PROMOTED");
  const writes = api.calls.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].body), {
    ref: "refs/heads/deploy/staging",
    sha,
  });
});
test("legacy production promotion cannot provide an approval or image-verification bypass", async () => {
  const api = transport([]);
  await assert.rejects(
    promote({ ...options, ...api, environment: "production" }),
    /Invalid promotion/,
  );
  assert.equal(api.calls.length, 0);
});
test("lost mutation response is reconciled without sending a second write", async () => {
  const api = transport([
    ...prefix(),
    ref("deploy/staging", older),
    new Error("synthetic transport loss"),
    ref("deploy/staging"),
  ]);
  assert.equal(
    (await promote({ ...options, ...api })).status,
    "PROMOTED_VERIFIED_AFTER_RESPONSE_LOSS",
  );
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, 1);
});
test("unresolved mutation result retains uncertainty and never retries", async () => {
  const api = transport([
    ...prefix(),
    ref("deploy/staging", older),
    new Error("lost write"),
    new Error("lost read"),
  ]);
  await assert.rejects(promote({ ...options, ...api }), /outcome uncertain/);
  assert.equal(api.calls.filter((call) => call.method !== "GET").length, 1);
});
test("permission failure cannot be interpreted as a missing branch or expose response", async () => {
  const api = transport([
    ...prefix(),
    { code: 403, body: { message: "synthetic-private-value" } },
  ]);
  await assert.rejects(
    promote({ ...options, ...api }),
    (error) =>
      /HTTP 403/.test(error.message) &&
      !error.message.includes("synthetic-private-value") &&
      !error.message.includes(options.token),
  );
  assert.ok(api.calls.every((call) => call.method === "GET"));
});
