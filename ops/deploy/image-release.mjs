import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const apps = ["api", "admin-web", "invitation-web"];

export async function verifyRelease({
  repository,
  token,
  sha,
  workflowSha,
  ref,
  event,
  fetchImpl = fetch,
}) {
  if (
    ref !== "refs/heads/master" ||
    event !== "workflow_dispatch" ||
    !token ||
    !repositoryPattern.test(repository ?? "") ||
    !shaPattern.test(sha ?? "") ||
    sha !== workflowSha
  )
    throw Error(
      "Release requires a manual master workflow and its exact full source SHA.",
    );
  async function get(path) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}${path}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) throw Error("Release authority could not be verified.");
    return response.json();
  }
  const master = await get("/git/ref/heads/master");
  if (
    master.ref !== "refs/heads/master" ||
    master.object?.type !== "commit" ||
    !shaPattern.test(master.object.sha)
  )
    throw Error("Master identity is unresolved.");
  const comparison = await get(`/compare/${sha}...${master.object.sha}`);
  if (
    comparison.base_commit?.sha !== sha ||
    !["ahead", "identical"].includes(comparison.status)
  )
    throw Error("Source SHA must already be merged into master.");
  const query = new URLSearchParams({
    head_sha: sha,
    branch: "master",
    event: "push",
    per_page: "1",
  });
  const runs = await get(`/actions/workflows/ci.yml/runs?${query}`);
  const run = runs.workflow_runs?.[0];
  if (
    run?.head_sha !== sha ||
    run.head_branch !== "master" ||
    run.event !== "push" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_repository?.full_name !== repository ||
    !Number.isSafeInteger(run.id) ||
    run.id <= 0
  )
    throw Error(
      "Latest master-push CI for the exact source SHA must have succeeded.",
    );
  return { sha, ciRunId: run.id };
}

export function releaseManifest({
  repository,
  sha,
  workflowSha,
  runId,
  runAttempt,
  ciRunId,
  digests,
}) {
  if (
    !repositoryPattern.test(repository ?? "") ||
    !shaPattern.test(sha ?? "") ||
    !shaPattern.test(workflowSha ?? "") ||
    ![runId, runAttempt, ciRunId].every((value) =>
      /^[1-9][0-9]*$/.test(String(value ?? "")),
    )
  )
    throw Error("Invalid release provenance.");
  const namespace = repository.toLowerCase();
  const releaseId = `${sha}-${runId}-${runAttempt}`;
  const images = Object.fromEntries(
    apps.map((app) => {
      const digest = digests[app];
      if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? ""))
        throw Error(`Missing registry digest for ${app}.`);
      const name = `ghcr.io/${namespace}/${app}`;
      return [
        app,
        {
          name,
          digest,
          reference: `${name}@${digest}`,
          platform: "linux/amd64",
        },
      ];
    }),
  );
  return {
    schemaVersion: 1,
    releaseId,
    sourceSha: sha,
    workflowSha,
    repository,
    workflowRunId: String(runId),
    workflowRunAttempt: String(runAttempt),
    ciRunId: String(ciRunId),
    workflowRunUrl: `https://github.com/${repository}/actions/runs/${runId}`,
    images,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const env = process.env;
    if (process.argv[2] === "verify") {
      const result = await verifyRelease({
        repository: env.GITHUB_REPOSITORY,
        token: env.GH_TOKEN,
        sha: env.RELEASE_SHA,
        workflowSha: env.GITHUB_SHA,
        ref: env.GITHUB_REF,
        event: env.GITHUB_EVENT_NAME,
      });
      // Only validated identifiers go to outputs, never token or API response bodies.
      const { appendFile } = await import("node:fs/promises");
      await appendFile(
        env.GITHUB_OUTPUT,
        `sha=${result.sha}\nci_run_id=${result.ciRunId}\n`,
      );
      console.log("Exact merged source SHA and successful master CI verified.");
    } else if (process.argv[2] === "manifest") {
      const manifest = releaseManifest({
        repository: env.GITHUB_REPOSITORY,
        sha: env.RELEASE_SHA,
        workflowSha: env.GITHUB_SHA,
        runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT,
        ciRunId: env.CI_RUN_ID,
        digests: {
          api: env.API_DIGEST,
          "admin-web": env.ADMIN_DIGEST,
          "invitation-web": env.INVITATION_DIGEST,
        },
      });
      const content = `${JSON.stringify(manifest, null, 2)}\n`;
      await mkdir("release", { recursive: true });
      await writeFile("release/release.json", content);
      await writeFile(
        "release/SHA256SUMS",
        `${createHash("sha256").update(content).digest("hex")}  release.json\n`,
      );
      console.log(`Release manifest written: ${manifest.releaseId}`);
    } else throw Error("Unknown release operation.");
  } catch {
    console.error(
      "Image release verification failed. No deployment was authorized.",
    );
    process.exitCode = 1;
  }
}
