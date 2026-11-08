import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { parse } from "yaml";
import { releaseManifest } from "./image-release.mjs";
import {
  repository,
  owner,
  apps,
  github,
  assertCurrentSource,
  verifyProductionProtection,
  validateManifest,
  loadPublishedRelease,
} from "./release-authority.mjs";
import { inspectImage, verifyImages } from "./verify-images.mjs";

const sha = "a".repeat(40),
  token = "synthetic-gh-token";
const digest = (character) => `sha256:${character.repeat(64)}`;
const manifest = releaseManifest({
  repository,
  sha,
  workflowSha: sha,
  runId: 456,
  runAttempt: 1,
  ciRunId: 123,
  digests: {
    api: digest("1"),
    "admin-web": digest("2"),
    "invitation-web": digest("3"),
  },
});
const content = `${JSON.stringify(manifest)}\n`;
const checksum = (text) =>
  `${createHash("sha256").update(text).digest("hex")}  release.json\n`;
const context = { sha, runId: 456, runAttempt: 1, ciRunId: 123 };
const environment = {
  id: 42,
  name: "production",
  protection_rules: [
    {
      type: "required_reviewers",
      reviewers: [{ type: "User", reviewer: owner }],
    },
  ],
  deployment_branch_policy: {
    protected_branches: false,
    custom_branch_policies: true,
  },
};
const policies = { branch_policies: [{ name: "master", type: "branch" }] };
const productionRun = {
  path: ".github/workflows/production-deploy.yml",
  head_branch: "master",
  head_repository: { full_name: repository },
  event: "workflow_run",
  run_attempt: 1,
};
const approval = {
  state: "approved",
  user: owner,
  environments: [{ id: 42, name: "production" }],
};

test("invalid checksum, source, CI provenance and image digests fail before deployment", () => {
  assert.deepEqual(
    validateManifest(content, checksum(content), context),
    manifest,
  );
  assert.throws(
    () => validateManifest(content, checksum("changed"), context),
    /checksum/,
  );
  for (const change of [
    { sourceSha: "b".repeat(40) },
    { workflowSha: "b".repeat(40) },
    { ciRunId: "999" },
    { extra: "untrusted" },
    {
      images: {
        ...manifest.images,
        api: {
          ...manifest.images.api,
          reference: "ghcr.io/foreign/project/api:latest",
        },
      },
    },
  ]) {
    const changed = JSON.stringify({ ...manifest, ...change });
    assert.throws(() => validateManifest(changed, checksum(changed), context));
  }
  const changed = JSON.stringify({
    ...manifest,
    images: { ...manifest.images, api: { digest: "latest" } },
  });
  assert.throws(() => validateManifest(changed, checksum(changed), context));
});

function protectionGet(changes = {}) {
  const responses = {
    "/environments/production": structuredClone(environment),
    "/environments/production/deployment-branch-policies":
      structuredClone(policies),
    "/actions/runs/789": structuredClone(productionRun),
    "/actions/runs/789/approvals": [structuredClone(approval)],
    ...changes,
  };
  return async (path) => {
    assert.ok(Object.hasOwn(responses, path), "Unexpected GitHub read");
    return responses[path];
  };
}

test("production requires actual OWNER review, master-only policy and a fresh deployment run", async () => {
  assert.equal(
    (await verifyProductionProtection(protectionGet(), 789)).requiredReviewer,
    owner.login,
  );
  for (const change of [
    { "/actions/runs/789/approvals": [] },
    { "/actions/runs/789/approvals": [{ ...approval, state: "rejected" }] },
    {
      "/actions/runs/789/approvals": [
        { ...approval, user: { ...owner, id: 99 } },
      ],
    },
    {
      "/actions/runs/789/approvals": [
        { ...approval, environments: [{ id: 999, name: "staging" }] },
      ],
    },
    { "/actions/runs/789": { ...productionRun, run_attempt: 2 } },
    { "/actions/runs/789": { ...productionRun, event: "pull_request" } },
    {
      "/actions/runs/789": {
        ...productionRun,
        head_repository: { full_name: "fork/project" },
      },
    },
    { "/environments/production": { ...environment, protection_rules: [] } },
    {
      "/environments/production/deployment-branch-policies": {
        branch_policies: [{ name: "*", type: "branch" }],
      },
    },
  ])
    await assert.rejects(
      verifyProductionProtection(protectionGet(change), 789),
    );
});

test("stale SHA and unavailable GitHub authority fail closed without credential details", async () => {
  await assert.rejects(
    assertCurrentSource(
      async () => ({
        ref: "refs/heads/master",
        object: { type: "commit", sha: "b".repeat(40) },
      }),
      sha,
    ),
    /Stale/,
  );
  for (const fakeFetch of [
    async () => {
      throw Error(`https://private.example/${token}`);
    },
    async () =>
      new Response(JSON.stringify({ message: token }), { status: 403 }),
  ])
    await assert.rejects(
      github(token, fakeFetch)("/environments/production"),
      (error) =>
        !error.message.includes(token) &&
        !error.message.includes("private.example"),
    );
});

function imageCommand(changes = {}) {
  return (args) => {
    const reference = args.at(-1),
      app = apps.find((app) => reference.includes(`/${app}@`));
    assert.ok(app, "Only expected image names are inspected");
    if (args.includes("--raw"))
      return JSON.stringify({
        manifests: [
          { platform: { os: "linux", architecture: "amd64" } },
          { platform: { os: "unknown", architecture: "unknown" } },
        ],
      });
    if (args[0] === "buildx") return `Digest: ${manifest.images[app].digest}\n`;
    if (args[0] === "pull") return "";
    return JSON.stringify([
      {
        Os: "linux",
        Architecture: "amd64",
        Config: {
          User: "node",
          Env: [`APP=${app}`],
          Cmd: ["sh", "ops/deploy/start.sh"],
          Healthcheck: { Test: ["CMD", "node", "ops/deploy/healthcheck.mjs"] },
          Labels: {
            "org.opencontainers.image.revision": sha,
            "org.opencontainers.image.source": `https://github.com/${repository}`,
          },
          ...changes,
        },
      },
    ]);
  };
}

test("registry verification checks all three actual digests, runtime platforms and revisions", async () => {
  const result = await verifyImages(manifest, { command: imageCommand() });
  assert.equal(Object.keys(result.images).length, 3);
  for (const change of [
    { User: "root" },
    { Healthcheck: { Test: ["NONE"] } },
    { Cmd: ["pnpm", "dev"] },
    {
      Labels: {
        "org.opencontainers.image.revision": "b".repeat(40),
        "org.opencontainers.image.source": `https://github.com/${repository}`,
      },
    },
  ])
    await assert.rejects(
      verifyImages(manifest, { command: imageCommand(change) }),
    );
  await assert.rejects(
    inspectImage({
      reference: "ghcr.io/foreign/project/api:latest",
      repository,
      app: "api",
      command: () => assert.fail("Invalid names must not reach Docker"),
    }),
  );
  await assert.rejects(
    verifyImages(manifest, {
      command: (args) =>
        args[0] === "buildx"
          ? `Digest: ${digest("9")}\n`
          : assert.fail("Unverified digest must not be pulled"),
    }),
  );
});

test("artifact download verifies exact trusted publisher, CI jobs, archive SHA and manifest before returning", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "invitation-release-test-"));
  t.after(async () => {
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
        basename(directory).startsWith("invitation-release-test-"),
    );
    await rm(directory, { recursive: true });
  });
  const archive = Buffer.from("synthetic archive bytes");
  const responses = {
    "/actions/runs/456": {
      id: 456,
      path: ".github/workflows/image-release.yml",
      status: "completed",
      conclusion: "success",
      head_branch: "master",
      head_repository: { full_name: repository },
      event: "workflow_run",
      head_sha: sha,
      run_attempt: 1,
    },
    "/git/ref/heads/master": {
      ref: "refs/heads/master",
      object: { type: "commit", sha },
    },
    [`/compare/${sha}...${sha}`]: { base_commit: { sha }, status: "identical" },
    "/actions/runs/456/jobs?per_page=100": {
      jobs: ["verify", "publish"].map((name) => ({
        name,
        status: "completed",
        conclusion: "success",
      })),
    },
    [`/actions/workflows/ci.yml/runs?head_sha=${sha}&branch=master&event=push&per_page=1`]:
      {
        workflow_runs: [
          {
            id: 123,
            head_sha: sha,
            head_branch: "master",
            head_repository: { full_name: repository },
            event: "push",
            status: "completed",
            conclusion: "success",
          },
        ],
      },
    "/actions/runs/123/jobs?per_page=100": {
      jobs: ["validate", "containers", "ready"].map((name) => ({
        name,
        status: "completed",
        conclusion: "success",
      })),
    },
    "/actions/runs/456/artifacts?name=production-images-456-1&per_page=100": {
      total_count: 1,
      artifacts: [
        {
          id: 999,
          name: "production-images-456-1",
          expired: false,
          workflow_run: { id: 456, head_sha: sha },
          size_in_bytes: archive.length,
          digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
        },
      ],
    },
  };
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith(".blob.core.windows.net")) {
      assert.equal(init.headers, undefined);
      return new Response(archive);
    }
    assert.equal(parsed.hostname, "api.github.com");
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    const key =
      parsed.pathname.replace(`/repos/${repository}`, "") + parsed.search;
    if (key === "/actions/artifacts/999/zip")
      return new Response(null, {
        status: 302,
        headers: {
          Location:
            "https://archive.blob.core.windows.net/release.zip?signature=synthetic",
        },
      });
    assert.ok(Object.hasOwn(responses, key), `Unexpected API path: ${key}`);
    return new Response(JSON.stringify(responses[key]));
  };
  const extract = (_path, entry) =>
    entry === "release.json" ? content : checksum(content);
  const stages = [];
  assert.deepEqual(
    (
      await loadPublishedRelease({
        runId: 456,
        token,
        directory,
        fetchImpl,
        extract,
        onStage: (stage) => stages.push(stage),
      })
    ).manifest,
    manifest,
  );
  assert.deepEqual(stages, ["RELEASE_AUTHORITY", "ARTIFACT_VALIDATION"]);
  const artifact =
    responses[
      "/actions/runs/456/artifacts?name=production-images-456-1&per_page=100"
    ].artifacts[0];
  const verifiedDigest = artifact.digest;
  artifact.digest = digest("f");
  await assert.rejects(
    loadPublishedRelease({ runId: 456, token, directory, fetchImpl, extract }),
    /archive digest does not match/,
  );
  artifact.digest = verifiedDigest;
  stages.length = 0;
  responses["/actions/runs/456"].conclusion = "failure";
  await assert.rejects(
    loadPublishedRelease({
      runId: 456,
      token,
      directory,
      fetchImpl,
      extract,
      onStage: (stage) => stages.push(stage),
    }),
    /successful trusted/,
  );
  assert.deepEqual(stages, ["RELEASE_AUTHORITY"]);
});

test("workflow chain keeps all production writes behind OWNER environment, lock and verified read-only preparation", async () => {
  const workflow = parse(
    await readFile(
      new URL("../../.github/workflows/production-deploy.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(workflow.on.workflow_run, {
    workflows: ["Publish production images"],
    types: ["completed"],
    branches: ["master"],
  });
  assert.equal(workflow.jobs.deploy.environment.name, "production");
  assert.equal(workflow.jobs.prepare.environment, undefined);
  assert.equal(workflow.jobs.deploy.needs, "prepare");
  assert.equal(
    workflow.jobs.deploy.concurrency.group,
    "coolify-production-i1ny5d0qigqbvbybbabmzo7l",
  );
  assert.equal(workflow.jobs.deploy.concurrency["cancel-in-progress"], false);
  const prepare = JSON.stringify(workflow.jobs.prepare);
  assert.doesNotMatch(
    prepare,
    /COOLIFY_API_TOKEN|production-release\.mjs (plan|deploy)/,
  );
  const deploy = workflow.jobs.deploy;
  assert.deepEqual(deploy.permissions, {
    contents: "read",
    actions: "read",
    packages: "read",
  });
  const planIndex = deploy.steps.findIndex((step) =>
    step.run?.endsWith(" plan"),
  );
  const mutateIndex = deploy.steps.findIndex((step) =>
    step.run?.endsWith(" deploy"),
  );
  assert.ok(planIndex >= 0 && mutateIndex > planIndex);
  assert.ok(
    deploy.steps
      .slice(planIndex + 1, mutateIndex)
      .some(
        (step) =>
          step.uses?.startsWith("actions/upload-artifact") &&
          step.with.path === "production-receipt/plan.json",
      ),
  );
  for (const job of Object.values(workflow.jobs))
    for (const step of job.steps)
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  const legacy = parse(
    await readFile(
      new URL("../../.github/workflows/promote.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(legacy.on.workflow_dispatch.inputs.environment.options, [
    "staging",
  ]);
});
