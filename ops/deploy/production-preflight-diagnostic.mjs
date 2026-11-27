import { randomBytes } from "node:crypto";
import {
  appendFile,
  link,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import {
  appliedConfigurationHashPattern,
  canonical,
  protectedSeal,
  protectedState,
  readSnapshot,
  target,
  validateResource,
} from "./coolify-production.mjs";
import {
  assertCurrentSource,
  github,
  idPattern,
  owner,
  repository,
  shaPattern,
  verifyProductionProtection,
} from "./release-authority.mjs";

const workflow = ".github/workflows/production-preflight-diagnostic.yml";
const applicationPath = "/applications/" + target.applicationUuid;
const readPaths = new Set([
  "/version",
  applicationPath,
  applicationPath + "/envs",
  applicationPath + "/storages",
  "/deployments/applications/" + target.applicationUuid + "?skip=0&take=20",
]);
const delayMs = 120_000;
const readIds = ["INITIAL", "IMMEDIATE", "DELAYED", "DELAYED_IMMEDIATE"];

const recordRows = (rows) =>
  Array.isArray(rows) &&
  rows.every(
    (row) => row !== null && typeof row === "object" && !Array.isArray(row),
  );

function assertSafeResponse(path, body) {
  if (path === applicationPath) {
    if (typeof body?.docker_compose_raw !== "string") throw Error();
    // Reject warnings without emitting source excerpts before the shared
    // validator parses the same YAML using deployed Compose semantics.
    const document = parseDocument(body.docker_compose_raw, {
      merge: true,
      logLevel: "silent",
    });
    if (document.errors.length || document.warnings.length) throw Error();
  }
  if (path === applicationPath + "/envs" && !recordRows(body)) throw Error();
  if (
    path === applicationPath + "/storages" &&
    (!recordRows(body?.persistent_storages) || !recordRows(body?.file_storages))
  )
    throw Error();
}

export function diagnosticClient(token, fetchImpl = fetch) {
  if (!token || /[\r\n]/.test(token))
    throw Error("DIAGNOSTIC_AUTHORITY_FAILED");
  return async (path, { method = "GET" } = {}) => {
    if (method !== "GET" || !readPaths.has(path))
      throw Error("DIAGNOSTIC_OPERATION_REJECTED");
    try {
      const response = await fetchImpl(
        target.coolifyOrigin + "/api/v1" + path,
        {
          method: "GET",
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok || response.redirected) throw Error();
      if (path === "/version") return await response.text();
      const body = await response.json();
      assertSafeResponse(path, body);
      return body;
    } catch {
      throw Error("DIAGNOSTIC_READ_FAILED");
    }
  };
}

export async function assertDiagnosticAuthority(env, get) {
  const { GITHUB_SHA: sha, GITHUB_RUN_ID: runId } = env;
  if (
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== "refs/heads/master" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_RUN_ATTEMPT !== "1" ||
    !shaPattern.test(sha ?? "") ||
    sha !== env.DIAGNOSTIC_SOURCE_SHA ||
    !idPattern.test(runId ?? "")
  )
    throw Error("DIAGNOSTIC_IDENTITY_REJECTED");
  const { environmentId } = await verifyProductionProtection(async (path) => {
    const result = await get(path);
    if (
      path === "/environments/production" &&
      result?.can_admins_bypass !== false
    )
      throw Error("Administrator bypass was not verified as disabled.");
    return result;
  });
  const run = await get("/actions/runs/" + runId);
  if (
    run.path !== workflow ||
    run.head_branch !== "master" ||
    run.head_repository?.full_name !== repository ||
    run.head_sha !== sha ||
    run.event !== "workflow_dispatch" ||
    run.run_attempt !== 1
  )
    throw Error("DIAGNOSTIC_RUN_REJECTED");

  const reviews = await get("/actions/runs/" + runId + "/approvals");
  const relevant = reviews.filter((review) =>
    review.environments?.some(
      (item) => item.id === environmentId && item.name === "production",
    ),
  );
  if (
    relevant.some((review) => review.state !== "approved") ||
    !relevant.some(
      (review) =>
        review.user?.id === owner.id && review.user?.login === owner.login,
    )
  )
    throw Error("DIAGNOSTIC_OWNER_APPROVAL_MISSING");
  // Read the ref last to catch changes during the policy and approval checks.
  await assertCurrentSource(get, sha);
}

const serialized = (value) => JSON.stringify(canonical(value));
const equal = (a, b) => serialized(a) === serialized(b);
const type = (value) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const sameMembership = (a, b) =>
  a.length === b.length &&
  equal(a.map(serialized).sort(), b.map(serialized).sort());

const fieldNames = {
  app: new Set([
    "uuid",
    "environment_id",
    "source_id",
    "source_type",
    "private_key_id",
    "git_repository",
    "git_branch",
    "git_commit_sha",
    "build_pack",
    "base_directory",
    "docker_compose_location",
    "docker_compose_custom_start_command",
    "docker_compose_custom_build_command",
    "docker_compose_domains",
    "domain_port_overrides",
    "pre_deployment_command",
    "post_deployment_command",
    "settings",
    "is_auto_deploy_enabled",
    "is_preserve_repository_enabled",
    "is_raw_compose_deployment_enabled",
    "is_preview_deployments_enabled",
    "connect_to_docker_network",
    "is_auto_cancel_queued_deployments_enabled",
    "is_auto_cancel_building_deployments_enabled",
    "disable_build_cache",
    "is_git_submodules_enabled",
    "is_git_lfs_enabled",
    "is_git_shallow_clone_enabled",
    "is_env_sorting_enabled",
    "include_coolify_default_variables",
    "is_image_scan_enabled",
    "created_at",
    "updated_at",
  ]),
  destination: new Set(["uuid", "serverUuid"]),
  compose: new Set([
    "services",
    "postgres",
    "migrate",
    "api",
    "admin-web",
    "invitation-web",
    "environment",
    "env_file",
    "image",
    "volumes",
    "networks",
    "database",
    "depends_on",
    "healthcheck",
    "exclude_from_hc",
    "ports",
    "entrypoint",
    "command",
    "restart",
  ]),
  storages: new Set([
    "persistent_storages",
    "file_storages",
    "id",
    "uuid",
    "name",
    "mount_path",
    "fs_path",
    "variable_fs_path",
    "content",
    "created_at",
    "is_binary",
    "is_too_large",
    "is_directory",
    "is_host_file",
    "is_based_on_git",
    "is_preview_suffix_enabled",
    "resource_type",
    "resource_id",
  ]),
  envs: new Set([
    "id",
    "uuid",
    "key",
    "value",
    "real_value",
    "is_preview",
    "is_literal",
    "is_multiline",
    "is_shown_once",
    "is_buildtime",
    "is_runtime",
    "is_shared",
    "is_required",
    "is_really_required",
    "is_buildpack_control",
    "is_coolify",
    "created_at",
    "comment",
    "order",
    "preserve_compose_null",
  ]),
};

function compareGroup(group, left, right) {
  const changes = new Set();
  function record(kind, path) {
    const known = path.filter((part) => fieldNames[group].has(part));
    // Paths never contain environment keys, IDs, or other provider-defined labels.
    const field =
      [
        ...known.slice(0, 3),
        ...(known.length !== path.length ? ["OTHER"] : []),
      ].join(".") || "GROUP";
    changes.add(field + ":" + kind);
  }
  function compare(a, b, path) {
    const aType = type(a);
    const bType = type(b);
    if (aType !== bType) {
      record(a === undefined || b === undefined ? "PRESENCE" : "TYPE", path);
    } else if (aType === "array") {
      const recordArray =
        (group === "envs" && path.length === 0) ||
        (group === "storages" && path.length === 1);
      if (recordArray && compareRecords(a, b, path)) return;
      if (equal(a, b)) return;
      if (sameMembership(a, b)) {
        record("ARRAY_ORDER", path);
      } else {
        record("ARRAY_MEMBERSHIP", path);
        for (let i = 0; i < Math.min(a.length, b.length); i++)
          compare(a[i], b[i], path);
      }
    } else if (aType === "object") {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        compare(
          Object.hasOwn(a, key) ? a[key] : undefined,
          Object.hasOwn(b, key) ? b[key] : undefined,
          [...path, key],
        );
    } else if (!equal(a, b)) {
      record("VALUE", path);
    }
  }
  function compareRecords(a, b, path) {
    // Coolify orders both storage collections by primary key. Environment
    // projection sorts by key/preview, so detect ties before aligning by ID.
    const ids = (rows) => rows.map((row) => row?.id);
    const aIds = ids(a);
    const bIds = ids(b);
    const validId = (id) => Number.isSafeInteger(id) && id > 0;
    const duplicateIds = (list) => {
      const valid = list.filter(validId);
      return new Set(valid).size !== valid.length;
    };
    if (duplicateIds(aIds) || duplicateIds(bIds))
      record("DUPLICATE_RECORD_ID", path);
    if (group === "envs") {
      const duplicateSortIdentity = (rows) =>
        new Set(rows.map((row) => serialized([row?.key, row?.is_preview])))
          .size !== rows.length;
      if (duplicateSortIdentity(a) || duplicateSortIdentity(b))
        record("DUPLICATE_SORT_IDENTITY", path);
    }
    if (!aIds.every(validId) || !bIds.every(validId)) {
      record("RECORD_ID_UNAVAILABLE", path);
      return false;
    }
    if (duplicateIds(aIds) || duplicateIds(bIds)) return false;
    if (!sameMembership(aIds, bIds)) record("ARRAY_MEMBERSHIP", path);
    const aSet = new Set(aIds);
    const bRows = new Map(bIds.map((id, index) => [id, b[index]]));
    if (
      !equal(
        aIds.filter((id) => bRows.has(id)),
        bIds.filter((id) => aSet.has(id)),
      )
    )
      record("ARRAY_ORDER", path);
    aIds.forEach((id, index) => {
      if (bRows.has(id)) compare(a[index], bRows.get(id), path);
    });
    return true;
  }
  compare(left, right, []);
  const sorted = [...changes].sort();
  return {
    equal: equal(left, right),
    changes: sorted.slice(0, 32),
    truncated: sorted.length > 32,
  };
}

const observedText = (value) =>
  typeof value === "string" && value.trim() !== "";
const observedHash = (value) =>
  typeof value === "string" && appliedConfigurationHashPattern.test(value);

function compareApplication(before, after, left, right) {
  const healthAvailable =
    observedText(before.status) && observedText(after.status);
  const appliedHashAvailable =
    observedHash(before.config_hash) && observedHash(after.config_hash);
  const destinationAvailable =
    observedText(left.destination.uuid) && observedText(right.destination.uuid);
  const destination = compareGroup(
    "destination",
    left.destination,
    right.destination,
  );
  return {
    healthAvailable,
    healthEqual: healthAvailable ? before.status === after.status : null,
    bothHealthy: healthAvailable
      ? before.status === "running:healthy" &&
        after.status === "running:healthy"
      : null,
    appliedHashAvailable,
    appliedHashEqual: appliedHashAvailable
      ? before.config_hash === after.config_hash
      : null,
    groups: {
      app: compareGroup("app", left.app, right.app),
      destination: {
        ...destination,
        available: destinationAvailable,
        equal: destinationAvailable ? destination.equal : null,
      },
      compose: compareGroup("compose", left.compose, right.compose),
    },
  };
}

function compareSnapshots(before, after, comparisonKey) {
  const left = protectedState(before);
  const right = protectedState(after);
  const { groups, ...application } = compareApplication(
    before.app,
    after.app,
    left,
    right,
  );
  return {
    ...application,
    protectedSealEqual:
      protectedSeal(before, comparisonKey) ===
      protectedSeal(after, comparisonKey),
    imagesEqual: equal(before.images, after.images),
    groups: {
      ...groups,
      storages: compareGroup("storages", left.storages, right.storages),
      envs: compareGroup("envs", left.envs, right.envs),
    },
  };
}

function incomplete(sample, code, reads = [], comparisons = []) {
  return {
    status: reads.length ? "PARTIAL" : "BLOCKED",
    delayMs,
    failure: { sample, code },
    reads,
    comparisons,
  };
}

export async function diagnose(
  api,
  wait = sleep,
  revalidateAuthority = async () => {},
) {
  const comparisonKey = randomBytes(32);
  const reads = [];
  const comparisons = [];
  let previous;
  for (const [index, sample] of readIds.entries()) {
    if (index === 2) {
      try {
        await wait(delayMs);
      } catch {
        return incomplete(
          sample,
          "DIAGNOSTIC_DELAY_FAILED",
          reads,
          comparisons,
        );
      }
      try {
        await revalidateAuthority();
      } catch {
        return incomplete(
          sample,
          "DIAGNOSTIC_AUTHORITY_FAILED",
          reads,
          comparisons,
        );
      }
    }
    const read = { sample, applicationRecheck: null };
    let snapshot;
    let opening;
    try {
      snapshot = await readSnapshot(api);
      opening = protectedState(snapshot);
      if (previous)
        comparisons.push({
          from: readIds[index - 1],
          to: sample,
          checks: compareSnapshots(previous, snapshot, comparisonKey),
        });
      reads.push(read);
    } catch {
      return incomplete(
        sample,
        "DIAGNOSTIC_SNAPSHOT_FAILED",
        reads,
        comparisons,
      );
    }
    try {
      // The bracket measures only application fields, even though the shared
      // projection also accepts the environment and storage from the opening read.
      const app = await api(applicationPath);
      const end = { ...snapshot, app, document: validateResource(app) };
      read.applicationRecheck = compareApplication(
        snapshot.app,
        app,
        opening,
        protectedState(end),
      );
    } catch {
      return incomplete(
        sample,
        "DIAGNOSTIC_APPLICATION_RECHECK_FAILED",
        reads,
        comparisons,
      );
    }
    previous = snapshot;
  }
  return { status: "OBSERVATIONS_CAPTURED", delayMs, reads, comparisons };
}

export async function diagnosticResult(env, fetchImpl = fetch, wait = sleep) {
  const verifyAuthority = () =>
    assertDiagnosticAuthority(env, github(env.GH_TOKEN, fetchImpl));
  try {
    await verifyAuthority();
  } catch {
    return incomplete("INITIAL", "DIAGNOSTIC_AUTHORITY_FAILED");
  }
  try {
    return await diagnose(
      diagnosticClient(env.COOLIFY_API_TOKEN, fetchImpl),
      wait,
      verifyAuthority,
    );
  } catch {
    return incomplete("INITIAL", "DIAGNOSTIC_SNAPSHOT_FAILED");
  }
}

export async function publishDiagnostic(
  report,
  summaryFile,
  directory = "diagnostic-receipt",
) {
  const content = JSON.stringify(report, null, 2) + "\n";
  async function writeArtifact() {
    await mkdir(directory, { recursive: true });
    const staging = await mkdtemp(resolve(directory, ".result-"));
    try {
      const staged = resolve(staging, "result.json");
      await writeFile(staged, content, { flag: "wx", mode: 0o600 });
      // Expose only the completed file and never overwrite an existing result.
      await link(staged, resolve(directory, "result.json"));
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  const outputs = await Promise.allSettled([
    writeArtifact(),
    appendFile(
      summaryFile,
      "## Protected configuration diagnostic\n\n```json\n" + content + "```\n",
    ),
  ]);
  if (outputs.some((output) => output.status === "rejected"))
    throw Error("DIAGNOSTIC_OUTPUT_FAILED");
}

export async function runDiagnosticCli(
  env,
  {
    fetchImpl = fetch,
    wait = sleep,
    directory,
    reportError = console.error,
  } = {},
) {
  try {
    const report = await diagnosticResult(env, fetchImpl, wait);
    await publishDiagnostic(report, env.GITHUB_STEP_SUMMARY, directory);
    if (report.status === "OBSERVATIONS_CAPTURED") return 0;
    reportError(report.failure.code);
  } catch {
    reportError("DIAGNOSTIC_OUTPUT_FAILED");
  }
  return 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runDiagnosticCli(process.env);
}
