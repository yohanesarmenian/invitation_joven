import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const targets = { staging: "deploy/staging", production: "deploy/production" };
const shaPattern = /^[a-f0-9]{40}$/;

export async function promote({
  repository,
  token,
  sha,
  environment,
  automatic = false,
  fetchImpl = fetch,
}) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
    !token ||
    !shaPattern.test(sha ?? "") ||
    !Object.hasOwn(targets, environment)
  )
    throw Error("Invalid promotion configuration; no reference was changed.");
  const branch = targets[environment];
  const base = `https://api.github.com/repos/${repository}`;
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw Error(
        "GitHub request outcome unavailable; response details omitted.",
      );
    }
    if (response.status === 404 && options.absentAllowed) return null;
    if (!response.ok)
      throw Error(
        `GitHub request refused or unavailable (HTTP ${response.status}); response details omitted.`,
      );
    try {
      return await response.json();
    } catch {
      throw Error("Invalid GitHub response; response details omitted.");
    }
  }
  const readRef = async (ref, absentAllowed = false) => {
    const value = await request(`/git/ref/heads/${ref}`, { absentAllowed });
    if (value === null) return null;
    if (
      value.ref !== `refs/heads/${ref}` ||
      value.object?.type !== "commit" ||
      !shaPattern.test(value.object.sha)
    )
      throw Error("GitHub reference identity is unresolved.");
    return value.object.sha;
  };
  const master = await readRef("master");
  if (automatic && (environment !== "staging" || master !== sha))
    return { status: "SKIPPED_STALE_AUTO_PROMOTION", environment, sha };
  const comparison = await request(`/compare/${sha}...${master}`);
  if (
    comparison.base_commit?.sha !== sha ||
    !["ahead", "identical"].includes(comparison.status)
  )
    throw Error(
      "Release SHA is not an ancestor of master; no reference was changed.",
    );
  const query = new URLSearchParams({
    head_sha: sha,
    branch: "master",
    event: "push",
    per_page: "1",
  });
  const runs = await request(`/actions/workflows/ci.yml/runs?${query}`);
  const run = runs.workflow_runs?.[0];
  if (
    run?.head_sha !== sha ||
    run.head_branch !== "master" ||
    run.event !== "push" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.head_repository?.full_name !== repository
  )
    throw Error(
      "The latest master-push CI run for this SHA must have succeeded; no reference was changed.",
    );
  const current = await readRef(branch, true);
  if (current === sha)
    return {
      status: "ALREADY_SELECTED_NO_NEW_WEBHOOK",
      environment,
      sha,
      branch,
    };
  // Recheck master immediately before an automatic promotion. GitHub's
  // fast-forward-only ref update separately protects the release branch.
  if (automatic && (await readRef("master")) !== sha)
    return { status: "SKIPPED_STALE_AUTO_PROMOTION", environment, sha };
  let writeError;
  try {
    await request(
      current === null ? "/git/refs" : `/git/refs/heads/${branch}`,
      {
        method: current === null ? "POST" : "PATCH",
        body:
          current === null
            ? { ref: `refs/heads/${branch}`, sha }
            : { sha, force: false },
      },
    );
  } catch (error) {
    writeError = error;
  }
  // A lost response is reconciled by an exact read, never a second mutation.
  let selected;
  try {
    selected = await readRef(branch, true);
  } catch {
    throw Error(
      "Promotion outcome uncertain. Inspect the exact release ref and Coolify deployment; do not retry automatically.",
    );
  }
  if (selected !== sha) {
    if (writeError)
      throw Error(
        "Promotion was not verified. Inspect the exact release ref before retrying; no automatic mutation retry was made.",
      );
    throw Error(
      "Release ref changed during promotion; inspect GitHub and Coolify before continuing.",
    );
  }
  return {
    status: writeError ? "PROMOTED_VERIFIED_AFTER_RESPONSE_LOSS" : "PROMOTED",
    environment,
    sha,
    branch,
    ciRunId: run.id,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.env.DEPLOYMENT_ENABLED !== "true")
      throw Error(
        "Deployment is disabled. Configure the selected GitHub Environment before promotion.",
      );
    const result = await promote({
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GH_TOKEN,
      sha: process.env.RELEASE_SHA,
      environment: process.env.DEPLOY_ENVIRONMENT,
      automatic: process.env.AUTOMATIC_PROMOTION === "true",
    });
    console.log(JSON.stringify(result));
    console.log(
      "A release ref is not deployment success. Verify the matching Coolify commit, migrations, health, HTTPS and staff/guest flow.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
