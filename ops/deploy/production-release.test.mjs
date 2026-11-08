import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { execute } from "./production-release.mjs";

const repository = "yohanesarmenian/invitation_joven";
const sensitive = "https://private.invalid/?credential=synthetic-secret";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "invitation-prepare-test-"));
  t.after(async () => {
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
        basename(directory).startsWith("invitation-prepare-test-"),
    );
    await rm(directory, { recursive: true });
  });
  // No test may contact GitHub, a registry, or production.
  t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected network"));
  const eventPath = join(directory, "event.json");
  await writeFile(
    eventPath,
    JSON.stringify({
      workflow_run: {
        id: 456,
        head_branch: "master",
        head_repository: { full_name: repository },
        path: ".github/workflows/image-release.yml",
        status: "completed",
        conclusion: "success",
      },
    }),
  );
  const env = {
    GITHUB_REPOSITORY: repository,
    GITHUB_REF: "refs/heads/master",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_EVENT_NAME: "workflow_run",
    GITHUB_EVENT_PATH: eventPath,
    GH_TOKEN: "synthetic-secret",
    RELEASE_RUN_ID: "456",
    GITHUB_OUTPUT: join(directory, "output"),
    GITHUB_STEP_SUMMARY: join(directory, "summary"),
  };
  const diagnostics = [],
    calls = [];
  const dependencies = {
    report: (diagnostic) => diagnostics.push(diagnostic),
    loadRelease: async ({ onStage }) => {
      onStage("RELEASE_AUTHORITY");
      calls.push("authority");
      onStage("ARTIFACT_VALIDATION");
      calls.push("artifact");
      return {
        manifest: {
          sourceSha: "a".repeat(40),
          workflowRunId: "456",
          ciRunId: "123",
        },
        artifactDigest: `sha256:${"b".repeat(64)}`,
      };
    },
    verifyRegistry: async () => calls.push("registry"),
    verifyProtection: async () => calls.push("protection"),
  };
  return { directory, env, diagnostics, calls, dependencies };
}

for (const stage of [
  "WORKFLOW_IDENTITY",
  "RELEASE_AUTHORITY",
  "ARTIFACT_VALIDATION",
  "REGISTRY_VERIFICATION",
  "PRODUCTION_PROTECTION",
  "PREPARE_OUTPUT",
]) {
  test(`prepare reports ${stage}_FAILED without leaking the underlying error`, async (t) => {
    const f = await fixture(t);
    if (stage === "WORKFLOW_IDENTITY") f.env.GITHUB_RUN_ATTEMPT = "2";
    if (["RELEASE_AUTHORITY", "ARTIFACT_VALIDATION"].includes(stage))
      f.dependencies.loadRelease = async ({ onStage }) => {
        onStage("RELEASE_AUTHORITY");
        if (stage === "ARTIFACT_VALIDATION") onStage(stage);
        throw Error(sensitive);
      };
    if (stage === "REGISTRY_VERIFICATION")
      f.dependencies.verifyRegistry = async () => {
        throw Error(sensitive);
      };
    if (stage === "PRODUCTION_PROTECTION")
      f.dependencies.verifyProtection = async () => {
        throw Error(sensitive);
      };
    if (stage === "PREPARE_OUTPUT") f.env.GITHUB_OUTPUT = f.directory;
    await assert.rejects(execute("prepare", f.env, f.dependencies), (error) => {
      assert.equal(error.code, `${stage}_FAILED`);
      assert.doesNotMatch(
        String(error.stack),
        /private\.invalid|synthetic-secret/,
      );
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(f.diagnostics.at(-1), {
      stage,
      status: "FAILED",
      code: `${stage}_FAILED`,
    });
    assert.doesNotMatch(
      JSON.stringify(f.diagnostics),
      /private\.invalid|synthetic-secret/,
    );
    const summary = await readFile(f.env.GITHUB_STEP_SUMMARY, "utf8");
    assert.ok(summary.includes(`${stage}_FAILED`));
    assert.doesNotMatch(summary, /private\.invalid|synthetic-secret/);
    if (stage !== "PREPARE_OUTPUT")
      await assert.rejects(readFile(f.env.GITHUB_OUTPUT), { code: "ENOENT" });
    if (stage === "WORKFLOW_IDENTITY") assert.deepEqual(f.calls, []);
    if (stage === "REGISTRY_VERIFICATION")
      assert.ok(!f.calls.includes("protection"));
  });
}

test("prepare reports trusted stage order and writes outputs only after every check", async (t) => {
  const f = await fixture(t);
  await execute("prepare", f.env, f.dependencies);
  assert.deepEqual(f.calls, [
    "authority",
    "artifact",
    "registry",
    "protection",
  ]);
  assert.deepEqual(
    f.diagnostics.filter((d) => d.status === "STARTED").map((d) => d.stage),
    [
      "WORKFLOW_IDENTITY",
      "RELEASE_AUTHORITY",
      "ARTIFACT_VALIDATION",
      "REGISTRY_VERIFICATION",
      "PRODUCTION_PROTECTION",
      "PREPARE_OUTPUT",
    ],
  );
  assert.ok(
    f.diagnostics.every((d) => ["STARTED", "SUCCEEDED"].includes(d.status)),
  );
  assert.equal(
    await readFile(f.env.GITHUB_OUTPUT, "utf8"),
    `source_sha=${"a".repeat(40)}\nrelease_run_id=456\n`,
  );
});

test("an untrusted diagnostic stage is rejected without printing it", async (t) => {
  const f = await fixture(t);
  f.dependencies.loadRelease = async ({ onStage }) => onStage(sensitive);
  await assert.rejects(execute("prepare", f.env, f.dependencies), {
    code: "WORKFLOW_IDENTITY_FAILED",
  });
  assert.doesNotMatch(
    JSON.stringify(f.diagnostics),
    /private\.invalid|synthetic-secret/,
  );
});

test("the real CLI fails closed with a stage code on a forbidden rerun", async (t) => {
  const f = await fixture(t);
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./production-release.mjs", import.meta.url)),
      "prepare",
    ],
    {
      env: { ...process.env, ...f.env, GITHUB_RUN_ATTEMPT: "2" },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /WORKFLOW_IDENTITY_FAILED/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /synthetic-secret|private\.invalid/,
  );
  assert.match(
    await readFile(f.env.GITHUB_STEP_SUMMARY, "utf8"),
    /WORKFLOW_IDENTITY_FAILED/,
  );
});

test("failed summary I/O preserves a sanitized failure code and never authorizes outputs", async (t) => {
  const f = await fixture(t);
  f.env.GITHUB_STEP_SUMMARY = f.directory;
  f.dependencies.verifyRegistry = async () => {
    throw Error(sensitive);
  };
  await assert.rejects(execute("prepare", f.env, f.dependencies), {
    code: "REGISTRY_VERIFICATION_FAILED",
  });
  assert.doesNotMatch(
    JSON.stringify(f.diagnostics),
    /synthetic-secret|private\.invalid/,
  );
  await assert.rejects(readFile(f.env.GITHUB_OUTPUT), { code: "ENOENT" });
});
