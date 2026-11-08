// GitHub Actions entrypoint. All writes are confined to the protected deploy job.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRelease } from "./image-release.mjs";
import {
  github,
  repository,
  loadPublishedRelease,
  verifyProductionProtection,
} from "./release-authority.mjs";
import { inspectImage, verifyImages } from "./verify-images.mjs";
import {
  target,
  coolifyClient,
  planDeployment,
  deployProduction,
  checkPublicAvailability,
  DeploymentError,
} from "./coolify-production.mjs";

const prepareStages = [
  "WORKFLOW_IDENTITY",
  "RELEASE_AUTHORITY",
  "ARTIFACT_VALIDATION",
  "REGISTRY_VERIFICATION",
  "PRODUCTION_PROTECTION",
  "PREPARE_OUTPUT",
];

export async function execute(action, env = process.env, dependencies = {}) {
  if (action !== "prepare") return executeRelease(action, env, dependencies);
  const report =
    dependencies.report ?? ((entry) => console.info(JSON.stringify(entry)));
  let stage;
  const onStage = (next) => {
    if (!prepareStages.includes(next)) throw Error("Invalid diagnostic stage.");
    if (stage) report({ stage, status: "SUCCEEDED" });
    stage = next;
    report({ stage, status: "STARTED" });
  };
  onStage("WORKFLOW_IDENTITY");
  try {
    const result = await executeRelease(action, env, {
      ...dependencies,
      onStage,
    });
    report({ stage, status: "SUCCEEDED" });
    return result;
  } catch {
    // Only fixed local identifiers may reach logs/summary. Never forward a
    // provider/command exception, its cause, headers, response body or URL.
    const code = `${stage}_FAILED`;
    report({ stage, status: "FAILED", code });
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        `\n## Production preparation blocked\n\nCode: \`${code}\`. Sensitive details omitted. No production deployment was authorized.\n`,
      ).catch(() => {
        // Keep the same fail-closed result and console code if summary I/O fails.
      });
    throw Object.assign(Error(`Production preparation blocked: ${code}.`), {
      code,
    });
  }
}

async function executeRelease(
  action,
  env,
  {
    onStage = () => {},
    loadRelease = loadPublishedRelease,
    verifyRegistry = verifyImages,
    verifyProtection = verifyProductionProtection,
  } = {},
) {
  if (
    !["prepare", "plan", "deploy"].includes(action) ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== "refs/heads/master" ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    !["workflow_run", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)
  )
    throw Error("Only a fresh trusted master deployment workflow may run.");
  if (
    action !== "prepare" &&
    (env.PRODUCTION_DEPLOYMENT_ENABLED !== "true" || !env.COOLIFY_API_TOKEN)
  ) {
    const message =
      "Production is inactive: enable PRODUCTION_DEPLOYMENT_ENABLED only after one-time safety checks and add COOLIFY_API_TOKEN to environment production. No Coolify write was made.";
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(env.GITHUB_STEP_SUMMARY, message + "\n");
    throw Error(message);
  }
  const get = github(env.GH_TOKEN);
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
  if (
    env.GITHUB_EVENT_NAME === "workflow_run" &&
    (event.workflow_run?.id !== Number(env.RELEASE_RUN_ID) ||
      event.workflow_run.head_branch !== "master" ||
      event.workflow_run.head_repository?.full_name !== repository ||
      event.workflow_run.path !== ".github/workflows/image-release.yml" ||
      event.workflow_run.status !== "completed" ||
      event.workflow_run.conclusion !== "success")
  )
    throw Error("Untrusted publisher trigger.");
  const directory = resolve("production-release");
  const { manifest, artifactDigest } = await loadRelease({
    runId: env.RELEASE_RUN_ID,
    token: env.GH_TOKEN,
    directory,
    onStage,
  });
  onStage("REGISTRY_VERIFICATION");
  await verifyRegistry(manifest);
  onStage("PRODUCTION_PROTECTION");
  await verifyProtection(
    get,
    action === "prepare" ? undefined : env.GITHUB_RUN_ID,
  );
  if (action === "prepare") {
    onStage("PREPARE_OUTPUT");
    await appendFile(
      env.GITHUB_OUTPUT,
      `source_sha=${manifest.sourceSha}\nrelease_run_id=${manifest.workflowRunId}\n`,
    );
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `## Release awaiting OWNER production approval\n\nSource: \`${manifest.sourceSha}\`\n\nCI: [${manifest.ciRunId}](https://github.com/${repository}/actions/runs/${manifest.ciRunId})\n\nPublisher: [${manifest.workflowRunId}](${manifest.workflowRunUrl})\n\nAll three registry digests and linux/amd64 runtime revisions verified. No Coolify credentials were used and no production writes were made.\n\nArtifact SHA-256: \`${artifactDigest}\`\n`,
    );
    return;
  }
  const assertAuthority = async () => {
    await verifyProductionProtection(get, env.GITHUB_RUN_ID);
    const authority = await verifyRelease({
      repository,
      token: env.GH_TOKEN,
      sha: manifest.sourceSha,
      workflowSha: manifest.sourceSha,
      ref: "refs/heads/master",
      event: "workflow_dispatch",
    });
    if (String(authority.ciRunId) !== manifest.ciRunId)
      throw new DeploymentError(
        "CI authority changed after publication. Publish a fresh verified release before deployment.",
      );
  };
  const api = coolifyClient(env.COOLIFY_API_TOKEN);
  const inspect = (reference, app) =>
    inspectImage({ reference, app, repository });
  const comparePrevious = async (previous, next) => {
    const comparison = await get(`/compare/${previous}...${next}`);
    if (
      comparison.base_commit?.sha !== previous ||
      !["ahead", "identical"].includes(comparison.status)
    )
      throw Error(
        "Current production is newer or diverged. An older release may not replace it.",
      );
  };
  await mkdir("production-receipt", { recursive: true });
  if (action === "plan") {
    const plan = await planDeployment({
      manifest,
      api,
      secret: env.COOLIFY_API_TOKEN,
      runId: env.GITHUB_RUN_ID,
      assertAuthority,
      inspect,
    });
    await comparePrevious(plan.previousSourceSha, manifest.sourceSha);
    await writeFile(
      "production-receipt/plan.json",
      `${JSON.stringify(plan, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `\n## Approved production plan\n\nTarget: \`${target.applicationUuid}\` on reviewed Coolify ${target.coolifyVersion}. Previous immutable image references captured in the plan artifact. Database volumes, secrets, domains and Compose dependencies were inspected without modification.\n`,
    );
    return;
  }
  const plan = JSON.parse(
    await readFile("production-receipt/plan.json", "utf8"),
  );
  const onReceipt = async (receipt) => {
    await writeFile(
      "production-receipt/outcome.json",
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 },
    );
  };
  try {
    const result = await deployProduction({
      plan,
      manifest,
      api,
      secret: env.COOLIFY_API_TOKEN,
      runId: env.GITHUB_RUN_ID,
      assertAuthority,
      comparePrevious,
      onReceipt,
      externalHealth: () => checkPublicAvailability(),
    });
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `\n## Production verification succeeded\n\nSource: \`${result.sourceSha}\`\n\nDeployment: \`${result.deploymentUuid}\`\n\nVerified the exact deployment source, matching applied configuration hashes and immutable image readback, successful migration log, Coolify healthy-container status, HTTPS pages and unauthenticated API rejection. Hidden configuration snapshots are not assumed available. No personal invitation URL or sensitive API/log content is published.\n\nGuest RSVP/business acceptance is separate; this workflow performs read-only availability checks.\n`,
    );
  } catch {
    const outcome = JSON.parse(
      await readFile("production-receipt/outcome.json", "utf8").catch(
        () => '{"stage":"PREFLIGHT","status":"BLOCKED"}',
      ),
    );
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `\n## Production stopped — reconciliation required\n\nStage: \`${outcome.stage}\`; status: \`${outcome.status}\`. ${outcome.reason ?? "Preflight did not complete."} Inspect the sanitized outcome and plan artifacts and matching Coolify deployment privately. No automatic mutation retry or database restore was performed. Do not rerun a non-idempotent action blindly. See docs/PRODUCTION-AUTOMATION.md.\n`,
    );
    throw Error(
      "Production did not pass verification. Inspect the sanitized receipt; do not retry blindly.",
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await execute(process.argv[2]);
  } catch (error) {
    if (error instanceof DeploymentError) {
      console.error(error.message);
      if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          `\n## Production preflight blocked\n\n${error.message}\n\nNo unverified operation will be retried automatically.\n`,
        );
    }
    console.error(
      "Production release blocked or unverified. Sensitive response, credential and log details omitted. Inspect the controlled Actions summary and receipt.",
    );
    process.exitCode = 1;
  }
}
