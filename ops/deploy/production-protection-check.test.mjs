import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

test("hosted protection regression uses the prepare token model without any production write capability", async () => {
  const workflow = parse(
    await readFile(
      new URL(
        "../../.github/workflows/production-protection-check.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const production = parse(
    await readFile(
      new URL("../../.github/workflows/production-deploy.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ["pull_request"]);
  assert.deepEqual(workflow.on.pull_request.branches, ["master"]);
  const job = workflow.jobs.protection;
  assert.deepEqual(job.permissions, production.jobs.prepare.permissions);
  assert.ok(Object.values(job.permissions).every((value) => value === "read"));
  assert.equal(job.environment, undefined);
  assert.match(job.if, /head\.repo\.full_name == github\.repository/);
  for (const step of job.steps) {
    if (step.uses)
      assert.match(
        step.uses,
        /^(actions\/checkout|actions\/setup-node)@[a-f0-9]{40}$/,
      );
    if (step.uses?.startsWith("actions/checkout"))
      assert.equal(step.with["persist-credentials"], false);
    if (step.run) {
      assert.equal(step.run, "node ops/deploy/production-protection-check.mjs");
      assert.deepEqual(step.env, { GH_TOKEN: "${{ github.token }}" });
    }
  }
  assert.doesNotMatch(
    JSON.stringify(workflow),
    /secrets\.|COOLIFY|production-release\.mjs|workflow_dispatch|pull_request_target/,
  );
});

test("protection probe rejects a foreign repository without accessing the network or printing credentials", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./production-protection-check.mjs", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "foreign/repository",
        GH_TOKEN: "synthetic-private-token",
      },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PROTECTION_CHECK_CONTEXT_INVALID/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /synthetic-private-token|https?:/,
  );
});
