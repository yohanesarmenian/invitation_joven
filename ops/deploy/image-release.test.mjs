import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { releaseManifest, verifyRelease } from "./image-release.mjs";

const sha = "a".repeat(40);
const repository = "Example/Invitation";
const options = {
  repository,
  token: "synthetic-test-token",
  sha,
  workflowSha: sha,
  ref: "refs/heads/master",
  event: "workflow_dispatch",
};
function responses({
  status = "ahead",
  conclusion = "success",
  event = "push",
  headRepository = repository,
} = {}) {
  return [
    {
      ref: "refs/heads/master",
      object: { type: "commit", sha: "b".repeat(40) },
    },
    { base_commit: { sha }, status },
    {
      workflow_runs: [
        {
          head_sha: sha,
          head_branch: "master",
          event,
          status: "completed",
          conclusion,
          head_repository: { full_name: headRepository },
          id: 123,
        },
      ],
    },
  ];
}
function transport(data) {
  return async (_url, request) => {
    assert.equal(request.redirect, "error");
    assert.equal(request.method, undefined); // read-only GitHub authority checks
    return { ok: true, json: async () => data.shift() };
  };
}

test("release accepts only an exact merged source with latest successful master CI", async () => {
  assert.deepEqual(
    await verifyRelease({ ...options, fetchImpl: transport(responses()) }),
    { sha, ciRunId: 123 },
  );
});
test("untrusted refs, PR events and malformed SHA fail before any GitHub request", async () => {
  for (const invalid of [
    { ref: "refs/heads/feature" },
    { event: "pull_request_target" },
    { event: "push" },
    { sha: "master; echo unsafe" },
    { workflowSha: "d".repeat(40) },
  ]) {
    await assert.rejects(
      verifyRelease({
        ...options,
        ...invalid,
        fetchImpl: () => assert.fail("Must not request GitHub"),
      }),
    );
  }
});
test("release refuses unmerged, failed, running, fork and PR CI authority", async () => {
  for (const change of [
    { status: "diverged" },
    { conclusion: "failure" },
    { conclusion: null },
    { headRepository: "Fork/Invitation" },
    { event: "pull_request" },
  ])
    await assert.rejects(
      verifyRelease({ ...options, fetchImpl: transport(responses(change)) }),
    );
  const wrongSha = responses();
  wrongSha[2].workflow_runs[0].head_sha = "c".repeat(40);
  await assert.rejects(
    verifyRelease({ ...options, fetchImpl: transport(wrongSha) }),
  );
});
test("GitHub outage or denied read authority fails closed", async () => {
  await assert.rejects(
    verifyRelease({ ...options, fetchImpl: async () => ({ ok: false }) }),
  );
});
const manifestInput = {
  repository,
  sha,
  workflowSha: sha,
  runId: "456",
  runAttempt: "1",
  ciRunId: "123",
  // Synthetic fixtures only, never a published release receipt.
  digests: {
    api: `sha256:${"1".repeat(64)}`,
    "admin-web": `sha256:${"2".repeat(64)}`,
    "invitation-web": `sha256:${"3".repeat(64)}`,
  },
};
test("manifest preserves actual input digests, complete provenance and amd64", () => {
  const manifest = releaseManifest(manifestInput);
  assert.equal(manifest.sourceSha, sha);
  assert.equal(manifest.workflowRunId, "456");
  assert.equal(manifest.releaseId, `${sha}-456-1`);
  for (const [app, image] of Object.entries(manifest.images)) {
    assert.equal(image.digest, manifestInput.digests[app]);
    assert.equal(
      image.reference,
      `ghcr.io/example/invitation/${app}@${image.digest}`,
    );
    assert.equal(image.platform, "linux/amd64");
  }
});
test("manifest rejects missing or mutable digest references and invalid provenance", () => {
  for (const digest of [
    undefined,
    "latest",
    "sha256:123",
    `sha256:${"G".repeat(64)}`,
  ])
    assert.throws(() =>
      releaseManifest({
        ...manifestInput,
        digests: { ...manifestInput.digests, api: digest },
      }),
    );
  assert.throws(() => releaseManifest({ ...manifestInput, sha: "master" }));
});
test("publisher is manual-only, isolated, pinned, least-privilege and never deploys", async () => {
  const doc = parse(
    await readFile(
      new URL("../../.github/workflows/image-release.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(doc.on), ["workflow_dispatch"]);
  assert.deepEqual(doc.permissions, { contents: "read" });
  assert.equal(doc.jobs.verify.permissions.actions, "read");
  assert.equal(doc.jobs.verify.permissions.packages, undefined);
  assert.deepEqual(doc.jobs.publish.permissions, {
    contents: "read",
    packages: "write",
  });
  assert.equal(doc.jobs.publish.environment, "image-release");
  assert.equal(doc.jobs.publish.needs, "verify");
  assert.equal(doc.concurrency["cancel-in-progress"], false);
  for (const job of Object.values(doc.jobs)) {
    assert.match(job.if, /refs\/heads\/master/);
    assert.match(job.if, /workflow_dispatch/);
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
      if (step.uses?.startsWith("actions/checkout"))
        assert.equal(step.with["persist-credentials"], false);
      assert.doesNotMatch(
        step.run ?? "",
        /coolify|ssh |docker compose|git push/,
      );
    }
  }
  const builds = doc.jobs.publish.steps.filter((step) =>
    step.uses?.startsWith("docker/build-push-action"),
  );
  assert.equal(builds.length, 3);
  for (const step of builds) {
    assert.equal(step.with.platforms, "linux/amd64");
    assert.equal(step.with.push, true);
    assert.equal(step.with.context, "source");
    assert.doesNotMatch(step.with.tags, /latest/);
    assert.doesNotMatch(
      step.with["build-args"],
      /PASSWORD|DATABASE_URL|CREDENTIAL_SECRET/,
    );
  }
});
