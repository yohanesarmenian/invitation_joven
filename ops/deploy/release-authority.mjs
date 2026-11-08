import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { releaseManifest, verifyRelease } from "./image-release.mjs";

export const owner = { login: "yohanesarmenian", id: 78153807 };
export const repository = "yohanesarmenian/invitation_joven";
export const apps = ["api", "admin-web", "invitation-web"];
export const imageKeys = {
  api: "API_IMAGE",
  "admin-web": "ADMIN_WEB_IMAGE",
  "invitation-web": "INVITATION_WEB_IMAGE",
};
export const shaPattern = /^[a-f0-9]{40}$/;
export const idPattern = /^[1-9][0-9]*$/;

class GitHubReadError extends Error {
  constructor(reason, httpStatus, transportCode) {
    super("GitHub read failed; response details omitted.");
    const knownTransportCodes = [
      "ECONNRESET",
      "UND_ERR_SOCKET",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "ECONNREFUSED",
    ];
    this.diagnostic = Object.freeze({
      reason,
      ...(Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599
        ? { httpStatus }
        : {}),
      ...(knownTransportCodes.includes(transportCode) ? { transportCode } : {}),
    });
  }
}

class ProtectionError extends Error {
  constructor(diagnostic) {
    super(
      "Production protection could not be verified; sensitive details omitted.",
    );
    this.diagnostic = Object.freeze(diagnostic);
  }
}

export function productionProtectionDiagnostic(error) {
  return error instanceof ProtectionError ? error.diagnostic : undefined;
}

export function github(token, fetchImpl = fetch) {
  if (!token) throw Error("GitHub read authority is missing.");
  return async (path, { binaryRedirect = false } = {}) => {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw Error("Invalid GitHub API path.");
    let response;
    try {
      response = await fetchImpl(
        `https://api.github.com/repos/${repository}${path}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            // Docker inspection blocks the event loop while GitHub may expire
            // an idle pooled socket. Do not retain API sockets across that gap.
            Connection: "close",
          },
          redirect: binaryRedirect ? "manual" : "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (error) {
      // Never propagate a URL, token, response body or underlying exception.
      throw new GitHubReadError(
        "API_TRANSPORT_ERROR",
        undefined,
        error?.cause?.code,
      );
    }
    if (binaryRedirect && response.status === 302) return response;
    if (!response.ok)
      throw new GitHubReadError("API_HTTP_ERROR", response.status);
    try {
      return await response.json();
    } catch {
      throw new GitHubReadError("API_JSON_ERROR");
    }
  };
}

export async function assertCurrentSource(get, sha) {
  if (!shaPattern.test(sha ?? "")) throw Error("Invalid source SHA.");
  const master = await get("/git/ref/heads/master");
  if (
    master.ref !== "refs/heads/master" ||
    master.object?.type !== "commit" ||
    master.object.sha !== sha
  )
    throw Error(
      "Stale release: current master is different. No new write allowed.",
    );
}

export async function verifyProductionProtection(get, runId) {
  const read = async (path, endpoint) => {
    try {
      return await get(path);
    } catch (error) {
      throw new ProtectionError({
        endpoint,
        ...(error instanceof GitHubReadError
          ? error.diagnostic
          : { reason: "API_READ_ERROR" }),
      });
    }
  };
  const environment = await read(
    "/environments/production",
    "PRODUCTION_ENVIRONMENT",
  );
  const policies = await read(
    "/environments/production/deployment-branch-policies",
    "DEPLOYMENT_BRANCH_POLICIES",
  );
  if (!environment || !Array.isArray(environment.protection_rules))
    throw new ProtectionError({
      endpoint: "PRODUCTION_ENVIRONMENT",
      reason: "MALFORMED_RESPONSE",
    });
  if (!policies || !Array.isArray(policies.branch_policies))
    throw new ProtectionError({
      endpoint: "DEPLOYMENT_BRANCH_POLICIES",
      reason: "MALFORMED_RESPONSE",
    });
  const reviewers = environment.protection_rules.find(
    (rule) => rule?.type === "required_reviewers",
  )?.reviewers;
  let field;
  if (
    environment.name !== "production" ||
    !Number.isSafeInteger(environment.id)
  )
    field = "ENVIRONMENT_IDENTITY";
  else if (
    !Array.isArray(reviewers) ||
    reviewers.length !== 1 ||
    reviewers[0]?.type !== "User" ||
    reviewers[0]?.reviewer?.id !== owner.id ||
    reviewers[0]?.reviewer?.login !== owner.login
  )
    field = "OWNER_REVIEWER";
  else if (
    environment.deployment_branch_policy?.protected_branches !== false ||
    environment.deployment_branch_policy?.custom_branch_policies !== true
  )
    field = "BRANCH_POLICY_MODE";
  else if (
    policies.branch_policies.length !== 1 ||
    policies.branch_policies[0]?.name !== "master" ||
    policies.branch_policies[0]?.type !== "branch"
  )
    field = "MASTER_BRANCH_POLICY";
  if (field)
    throw new ProtectionError({
      endpoint: "PROTECTION_POLICY",
      reason: "POLICY_MISMATCH",
      field,
    });
  if (runId !== undefined) {
    if (!idPattern.test(String(runId)))
      throw Error("Invalid deployment run ID.");
    const run = await get(`/actions/runs/${runId}`);
    if (
      run.path !== ".github/workflows/production-deploy.yml" ||
      run.head_branch !== "master" ||
      run.head_repository?.full_name !== repository ||
      !["workflow_run", "workflow_dispatch"].includes(run.event) ||
      run.run_attempt !== 1
    )
      throw Error("Only a fresh trusted production workflow run may write.");
    const reviews = await get(`/actions/runs/${runId}/approvals`);
    const relevant = reviews.filter((review) =>
      review.environments?.some(
        (item) => item.id === environment.id && item.name === "production",
      ),
    );
    // Even an accidentally removed protection rule or an admin force-start
    // cannot replace a recorded approval from the designated OWNER.
    if (
      relevant.some((review) => review.state !== "approved") ||
      !relevant.some(
        (review) =>
          review.state === "approved" &&
          review.user?.id === owner.id &&
          review.user?.login === owner.login,
      )
    )
      throw Error("This run has no verified production approval from OWNER.");
  }
  return { environmentId: environment.id, requiredReviewer: owner.login };
}

export function validateManifest(content, checksum, context) {
  if (
    typeof content !== "string" ||
    content.length > 64_000 ||
    !/^([a-f0-9]{64}) {2}release\.json\r?\n?$/.test(checksum ?? "") ||
    createHash("sha256").update(content).digest("hex") !== checksum.slice(0, 64)
  )
    throw Error("Release checksum is invalid.");
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch {
    throw Error("Release manifest is invalid.");
  }
  const expected = releaseManifest({
    repository,
    sha: context.sha,
    workflowSha: context.sha,
    runId: context.runId,
    runAttempt: context.runAttempt,
    ciRunId: context.ciRunId,
    digests: Object.fromEntries(
      apps.map((app) => [app, manifest.images?.[app]?.digest]),
    ),
  });
  if (!isDeepStrictEqual(manifest, expected))
    throw Error("Release manifest provenance or image set is invalid.");
  return manifest;
}

export async function loadPublishedRelease({
  runId,
  token,
  directory,
  onStage = () => {},
  fetchImpl = fetch,
  extract = (archive, entry) =>
    execFileSync("unzip", ["-p", archive, entry], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64_000,
    }),
}) {
  if (!idPattern.test(String(runId))) throw Error("Invalid publisher run ID.");
  onStage("RELEASE_AUTHORITY");
  const get = github(token, fetchImpl);
  const run = await get(`/actions/runs/${runId}`);
  if (
    run.id !== Number(runId) ||
    run.path !== ".github/workflows/image-release.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_branch !== "master" ||
    run.head_repository?.full_name !== repository ||
    !["workflow_dispatch", "workflow_run"].includes(run.event) ||
    !shaPattern.test(run.head_sha ?? "") ||
    !Number.isSafeInteger(run.run_attempt)
  )
    throw Error("Publisher run is not a successful trusted master release.");
  await assertCurrentSource(get, run.head_sha);
  const jobs = await get(`/actions/runs/${runId}/jobs?per_page=100`);
  if (
    !["verify", "publish"].every((name) =>
      jobs.jobs?.some(
        (job) =>
          job.name === name &&
          job.status === "completed" &&
          job.conclusion === "success",
      ),
    )
  )
    throw Error("Publisher verification and publication jobs did not succeed.");
  const authority = await verifyRelease({
    repository,
    token,
    sha: run.head_sha,
    workflowSha: run.head_sha,
    ref: "refs/heads/master",
    event: "workflow_dispatch",
    fetchImpl,
  });
  onStage("ARTIFACT_VALIDATION");
  const artifactName = `production-images-${runId}-${run.run_attempt}`;
  const artifacts = await get(
    `/actions/runs/${runId}/artifacts?name=${artifactName}&per_page=100`,
  );
  if (artifacts.total_count !== 1 || artifacts.artifacts?.length !== 1)
    throw Error("A unique complete release artifact is required.");
  const artifact = artifacts.artifacts[0];
  if (
    artifact.name !== artifactName ||
    artifact.expired !== false ||
    artifact.workflow_run?.id !== Number(runId) ||
    artifact.workflow_run?.head_sha !== run.head_sha ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") ||
    !Number.isSafeInteger(artifact.id) ||
    !Number.isSafeInteger(artifact.size_in_bytes) ||
    artifact.size_in_bytes <= 0 ||
    artifact.size_in_bytes > 2_000_000
  )
    throw Error("Release artifact identity is invalid.");
  const redirect = await get(`/actions/artifacts/${artifact.id}/zip`, {
    binaryRedirect: true,
  });
  let bytes;
  try {
    const location = new URL(redirect.headers.get("location"));
    if (
      location.protocol !== "https:" ||
      ![".blob.core.windows.net", ".actions.githubusercontent.com"].some(
        (suffix) => location.hostname.endsWith(suffix),
      )
    )
      throw Error();
    // Do not forward GitHub authorization to the signed storage URL.
    const downloaded = await fetchImpl(location.href, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!downloaded.ok) throw Error();
    bytes = Buffer.from(await downloaded.arrayBuffer());
    if (bytes.length > 2_000_000) throw Error();
  } catch {
    throw Error("Release archive download failed; URL and details omitted.");
  }
  if (
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
    artifact.digest
  )
    throw Error("GitHub release archive digest does not match.");
  await mkdir(directory, { recursive: true });
  const archive = resolve(directory, "release.zip");
  await writeFile(archive, bytes, { mode: 0o600 });
  let content, checksum;
  try {
    // Read only the two named entries: no arbitrary ZIP paths are extracted.
    content = extract(archive, "release.json");
    checksum = extract(archive, "SHA256SUMS");
  } catch {
    throw Error("Release archive entries are invalid.");
  }
  const manifest = validateManifest(content, checksum, {
    sha: run.head_sha,
    runId,
    runAttempt: run.run_attempt,
    ciRunId: authority.ciRunId,
  });
  await writeFile(resolve(directory, "release.json"), content);
  await writeFile(resolve(directory, "SHA256SUMS"), checksum);
  return { manifest, artifactDigest: artifact.digest };
}
