import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import {
  apps,
  imageKeys,
  repository,
  shaPattern,
} from "./release-authority.mjs";

export const target = JSON.parse(
  await readFile(new URL("./production-target.json", import.meta.url), "utf8"),
);
const approvedCompose = parse(
  await readFile(
    new URL("../../compose.production.yaml", import.meta.url),
    "utf8",
  ),
  { merge: true },
);
export class DeploymentError extends Error {}

const uuidPattern = /^[a-zA-Z0-9]{8,64}$/;
const blank = (value) => value === undefined || value === null || value === "";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function seal(value, secret) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function compose(raw) {
  try {
    const document = parse(raw, { merge: true, maxAliasCount: 100 });
    if (!document?.services) throw new DeploymentError();
    return document;
  } catch {
    throw new DeploymentError(
      "Coolify Compose content is unreadable or invalid.",
    );
  }
}

export function assertCompose(raw) {
  const document = compose(raw),
    s = document.services;
  if (
    !s.postgres ||
    !s.migrate ||
    !s.api ||
    !s["admin-web"] ||
    !s["invitation-web"]
  )
    throw new DeploymentError("Production services are missing.");
  if (
    Object.values(s).some(
      (service) => service.build || service.profiles || service.ports?.length,
    )
  )
    throw new DeploymentError(
      "Unexpected builds, profiles or host-published ports in production Compose.",
    );
  if (
    s.migrate.image !== "${API_IMAGE:?Set immutable API image digest}" ||
    s.api.image !== s.migrate.image ||
    s["admin-web"].image !==
      "${ADMIN_WEB_IMAGE:?Set immutable admin web image digest}" ||
    s["invitation-web"].image !==
      "${INVITATION_WEB_IMAGE:?Set immutable invitation web image digest}" ||
    s.migrate.restart !== "no" ||
    !isDeepStrictEqual(s.migrate.command, [
      "node",
      "/workspace/ops/deploy/migrate.mjs",
    ]) ||
    s.migrate.depends_on?.postgres?.condition !== "service_healthy" ||
    s.api.depends_on?.postgres?.condition !== "service_healthy" ||
    s.api.depends_on?.migrate?.condition !== "service_completed_successfully" ||
    s["admin-web"].depends_on?.api?.condition !== "service_healthy" ||
    s["invitation-web"].depends_on?.api?.condition !== "service_healthy" ||
    document.networks?.database?.internal !== true ||
    !isDeepStrictEqual(s.postgres.networks, ["database"]) ||
    !s.postgres.volumes?.includes(
      "invitation_postgres_data:/var/lib/postgresql",
    ) ||
    !Object.hasOwn(document.volumes ?? {}, "invitation_postgres_data") ||
    s.api.environment?.NODE_ENV !== "production" ||
    s["admin-web"].environment?.ADMIN_API_INTERNAL_BASE_URL !==
      "http://api:4000" ||
    s["invitation-web"].environment?.INVITATION_API_BASE_URL !==
      "http://api:4000" ||
    [s.api, s["admin-web"], s["invitation-web"]].some(
      (service) =>
        service.command ||
        service.entrypoint ||
        service.exclude_from_hc ||
        service.healthcheck?.disable,
    )
  )
    throw new DeploymentError(
      "PostgreSQL volume, migration or application health dependency contract changed.",
    );
  for (const name of ["postgres", "migrate", ...apps]) {
    const actual = structuredClone(s[name]);
    // Coolify's optional one-shot exclusion does not change native startup.
    if (name === "migrate" && actual.exclude_from_hc === true)
      delete actual.exclude_from_hc;
    if (!isDeepStrictEqual(actual, approvedCompose.services[name]))
      throw new DeploymentError(
        "Core production service differs from reviewed repository Compose.",
      );
  }
  if (
    !isDeepStrictEqual(
      document.networks.database,
      approvedCompose.networks.database,
    ) ||
    !isDeepStrictEqual(
      document.volumes.invitation_postgres_data,
      approvedCompose.volumes.invitation_postgres_data,
    )
  )
    throw new DeploymentError(
      "Production database network or volume definition changed.",
    );
  return document;
}

export function coolifyClient(token, { fetchImpl = fetch } = {}) {
  if (!token || /[\r\n]/.test(token))
    throw new DeploymentError("Coolify API authority is missing.");
  return async (path, { method = "GET", body, text = false } = {}) => {
    const appPath = `/applications/${target.applicationUuid}`;
    const allowed =
      method === "GET"
        ? path === "/version" ||
          path === appPath ||
          path === `${appPath}/envs` ||
          path === `${appPath}/storages` ||
          path ===
            `/deployments/applications/${target.applicationUuid}?skip=0&take=20` ||
          path ===
            `${appPath}/logs?service_name=migrate&lines=100&show_timestamps=true` ||
          /^\/deployments\/[a-zA-Z0-9]{8,64}$/.test(path)
        : (method === "PATCH" && path === `${appPath}/envs/bulk`) ||
          (method === "POST" && path === `${appPath}/start`);
    if (!allowed)
      throw new DeploymentError(
        "Coolify operation is outside the production release allowlist.",
      );
    if (
      method === "PATCH" &&
      (!Array.isArray(body?.data) ||
        body.data.length !== 3 ||
        !isDeepStrictEqual(
          body.data.map((item) => item.key).sort(),
          Object.values(imageKeys).sort(),
        ) ||
        body.data.some(
          (item) =>
            Object.keys(item).sort().join(",") !== "is_preview,key,value" ||
            item.is_preview !== false ||
            !apps.some(
              (app) =>
                imageKeys[app] === item.key &&
                typeof item.value === "string" &&
                item.value.startsWith(`ghcr.io/${repository}/${app}@sha256:`) &&
                /^[a-f0-9]{64}$/.test(item.value.split("@sha256:")[1] ?? ""),
            ),
        ))
    )
      throw new DeploymentError(
        "Only the three existing production image values may be updated.",
      );
    if (
      method === "POST" &&
      !isDeepStrictEqual(body, { force: false, instant_deploy: false })
    )
      throw new DeploymentError("Unexpected deployment request options.");
    try {
      const response = await fetchImpl(
        `${target.coolifyOrigin}/api/v1${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw new DeploymentError();
      return text ? await response.text() : await response.json();
    } catch {
      throw new DeploymentError(
        method === "GET"
          ? "Coolify read failed; sensitive details omitted."
          : "Coolify mutation outcome requires reconciliation; sensitive details omitted.",
      );
    }
  };
}

function imagesFrom(envs) {
  const images = {};
  for (const app of apps) {
    const rows = envs.filter(
      (row) => row.key === imageKeys[app] && row.is_preview === false,
    );
    if (
      rows.length !== 1 ||
      rows[0].is_shown_once ||
      typeof rows[0].value !== "string" ||
      !rows[0].value.startsWith(`ghcr.io/${repository}/${app}@sha256:`) ||
      !/^[a-f0-9]{64}$/.test(rows[0].value.split("@sha256:")[1] ?? "")
    )
      throw new DeploymentError(
        "Current production must contain three unique readable immutable image references.",
      );
    images[app] = rows[0].value;
  }
  return images;
}

export function validateResource(app) {
  if (
    app?.uuid !== target.applicationUuid ||
    app.build_pack !== "dockercompose" ||
    app.destination?.server?.uuid !== target.serverUuid ||
    ![
      repository,
      `https://github.com/${repository}`,
      `https://github.com/${repository}.git`,
    ].includes(app.git_repository) ||
    app.git_branch !== "master" ||
    (!blank(app.git_commit_sha) && app.git_commit_sha !== "HEAD") ||
    app.base_directory !== "/" ||
    app.docker_compose_location !== target.composeLocation ||
    app.settings?.is_auto_deploy_enabled !== false ||
    app.settings?.is_preserve_repository_enabled !== true ||
    app.settings?.is_raw_compose_deployment_enabled !== false ||
    app.settings?.is_preview_deployments_enabled !== false ||
    app.settings?.connect_to_docker_network !== false ||
    app.additional_servers_count !== 0 ||
    !blank(app.docker_compose_custom_build_command) ||
    ![undefined, null, "", "docker compose up -d"].includes(
      app.docker_compose_custom_start_command,
    ) ||
    !blank(app.pre_deployment_command) ||
    !blank(app.post_deployment_command) ||
    app.additional_servers?.length
  )
    throw new DeploymentError(
      "Unexpected Coolify resource, server, source, webhook or startup settings. No write allowed.",
    );
  const document = assertCompose(app.docker_compose_raw);
  let domains;
  try {
    domains =
      typeof app.docker_compose_domains === "string"
        ? JSON.parse(app.docker_compose_domains)
        : app.docker_compose_domains;
  } catch {
    throw new DeploymentError("Production domain mapping is unreadable.");
  }
  for (const [name, expected] of [
    ["admin-web", target.adminOrigin],
    ["invitation-web", target.invitationOrigin],
  ]) {
    const domain = domains?.[name]?.domain;
    if (
      domain !== expected &&
      domain !== `${expected}:${name === "admin-web" ? 3001 : 3000}`
    )
      throw new DeploymentError(
        "Production public domains differ from the approved resource.",
      );
  }
  if (!blank(domains?.api?.domain) || !blank(domains?.postgres?.domain))
    throw new DeploymentError(
      "API and PostgreSQL must not have public domains.",
    );
  return document;
}

export async function readSnapshot(api) {
  const base = `/applications/${target.applicationUuid}`;
  const version = await api("/version", { text: true });
  if (version.trim().replace(/^v/, "") !== target.coolifyVersion)
    throw new DeploymentError(
      "Installed Coolify version differs from the reviewed API adapter.",
    );
  const app = await api(base);
  const document = validateResource(app);
  const envs = await api(`${base}/envs`),
    storages = await api(`${base}/storages`);
  if (
    !Array.isArray(envs) ||
    !Array.isArray(storages?.persistent_storages) ||
    !Array.isArray(storages?.file_storages)
  )
    throw new DeploymentError(
      "Installed Coolify configuration response is unsupported.",
    );
  const images = imagesFrom(envs);
  const history = await api(
    `/deployments/applications/${target.applicationUuid}?skip=0&take=20`,
  );
  if (
    !Array.isArray(history?.deployments) ||
    !history.deployments.length ||
    history.deployments.some(
      (item) =>
        !uuidPattern.test(item.deployment_uuid ?? "") ||
        !/^\d+$/.test(String(item.application_id ?? "")),
    ) ||
    new Set(history.deployments.map((item) => String(item.application_id)))
      .size !== 1
  )
    throw new DeploymentError(
      "Existing application deployment identity cannot be verified.",
    );
  return {
    app,
    envs,
    storages,
    document,
    images,
    history: history.deployments,
  };
}

function protectedState(snapshot) {
  const fields = [
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
  ];
  return {
    app: Object.fromEntries(fields.map((key) => [key, snapshot.app[key]])),
    destination: {
      uuid: snapshot.app.destination?.uuid,
      serverUuid: snapshot.app.destination?.server?.uuid,
    },
    compose: snapshot.document,
    storages: Object.fromEntries(
      Object.entries(snapshot.storages).map(([kind, rows]) => [
        kind,
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(([key]) => key !== "updated_at"),
          ),
        ),
      ]),
    ),
    envs: snapshot.envs
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(
            ([key]) =>
              key !== "updated_at" &&
              !(
                Object.values(imageKeys).includes(row.key) &&
                row.is_preview === false &&
                ["value", "real_value"].includes(key)
              ),
          ),
        ),
      )
      .sort((a, b) =>
        `${a.key}:${a.is_preview}`.localeCompare(`${b.key}:${b.is_preview}`),
      ),
  };
}
function protectedSeal(snapshot, secret) {
  return seal(protectedState(snapshot), secret);
}
function noActiveDeployment(snapshot) {
  if (
    snapshot.history.some(
      (item) =>
        !["finished", "failed", "cancelled", "cancelled-by-user"].includes(
          item.status,
        ),
    )
  )
    throw new DeploymentError(
      "Another deployment is active or has an unknown state. Reconcile before retrying.",
    );
}

export async function planDeployment({
  manifest,
  api,
  secret,
  runId,
  assertAuthority,
  inspect,
}) {
  await assertAuthority();
  const snapshot = await readSnapshot(api);
  noActiveDeployment(snapshot);
  if (snapshot.app.status !== "running:healthy")
    throw new DeploymentError(
      "Existing resource health is not verified. No automatic rollout allowed.",
    );
  // Reviewed v4.7.3 hides configuration_snapshot for read:sensitive. It exposes the
  // applied SHA-256 on both Application and DeploymentQueue instead. Confirm
  // that real read capability before allowing any image mutation.
  const applied = snapshot.history.find(
    (item) =>
      item.status === "finished" &&
      item.configuration_hash === snapshot.app.config_hash,
  );
  if (!/^[a-f0-9]{64}$/.test(snapshot.app.config_hash ?? "") || !applied)
    throw new DeploymentError(
      "Existing applied configuration hashes cannot be verified. No write allowed.",
    );
  const appliedRecord = await api(`/deployments/${applied.deployment_uuid}`);
  if (
    appliedRecord.deployment_uuid !== applied.deployment_uuid ||
    appliedRecord.status !== "finished" ||
    String(appliedRecord.application_id) !== String(applied.application_id) ||
    appliedRecord.configuration_hash !== snapshot.app.config_hash
  )
    throw new DeploymentError(
      "Installed deployment API did not expose matching applied configuration evidence.",
    );
  const previousRevisions = [];
  for (const app of apps) {
    const image = await inspect(snapshot.images[app], app);
    if (!shaPattern.test(image.revision))
      throw new DeploymentError("Previous image revision is not verified.");
    previousRevisions.push(image.revision);
  }
  if (new Set(previousRevisions).size !== 1)
    throw new DeploymentError(
      "Current images are not a coordinated release. Reconcile first.",
    );
  const plan = {
    schemaVersion: 1,
    applicationUuid: target.applicationUuid,
    serverUuid: target.serverUuid,
    sourceSha: manifest.sourceSha,
    releaseId: manifest.releaseId,
    runId: String(runId),
    applicationId: String(snapshot.history[0].application_id),
    previousImages: snapshot.images,
    previousSourceSha: previousRevisions[0],
    previousConfigurationHash: snapshot.app.config_hash,
    nextImages: Object.fromEntries(
      apps.map((app) => [app, manifest.images[app].reference]),
    ),
    protectedConfiguration: protectedSeal(snapshot, secret),
    previousDeployments: snapshot.history.map((item) => item.deployment_uuid),
  };
  return { ...plan, seal: seal(plan, secret) };
}

export function verifyDeploymentRecord(record, plan) {
  if (
    String(record.application_id) !== plan.applicationId ||
    !uuidPattern.test(record.deployment_uuid ?? "") ||
    record.pull_request_id !== 0 ||
    record.restart_only === true ||
    record.rollback === true
  )
    throw new DeploymentError("Unexpected deployment identity or operation.");
  if (record.status !== "finished") return false;
  if (record.commit !== plan.sourceSha)
    throw new DeploymentError(
      "Deployed Git source does not match the approved release.",
    );
  // The successful-deployment handler updates this hash and Application.config_hash
  // from the same internal snapshot (which includes every image environment value).
  // Status can become finished immediately before those hash updates: poll reads.
  if (!/^[a-f0-9]{64}$/.test(record.configuration_hash ?? "")) return false;
  if (
    !isDeepStrictEqual(plan.previousImages, plan.nextImages) &&
    record.configuration_hash === plan.previousConfigurationHash
  )
    throw new DeploymentError(
      "Deployment retained the previous applied configuration hash.",
    );
  return true;
}

export function migrationSucceeded(logs, since) {
  if (typeof logs !== "string" || !Number.isFinite(Date.parse(since)))
    return false;
  return logs.split(/\r?\n/).some((line) => {
    const match = line.match(
      /^(\d{4}-\d\d-\d\dT\S+) Prisma migrate deploy succeeded\.$/,
    );
    return match && Date.parse(match[1]) >= Date.parse(since);
  });
}

export async function deployProduction({
  plan,
  manifest,
  api,
  secret,
  runId,
  assertAuthority,
  comparePrevious,
  onReceipt = async () => {},
  externalHealth,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxPolls = 90,
}) {
  const { seal: signature, ...unsigned } = plan;
  if (
    signature !== seal(unsigned, secret) ||
    plan.runId !== String(runId) ||
    plan.applicationUuid !== target.applicationUuid ||
    plan.sourceSha !== manifest.sourceSha ||
    plan.releaseId !== manifest.releaseId ||
    !isDeepStrictEqual(
      plan.nextImages,
      Object.fromEntries(
        apps.map((app) => [app, manifest.images[app].reference]),
      ),
    )
  )
    throw new DeploymentError(
      "Deployment plan identity or integrity is invalid.",
    );
  const receipt = {
    sourceSha: plan.sourceSha,
    releaseId: plan.releaseId,
    applicationUuid: plan.applicationUuid,
    previousImages: plan.previousImages,
    nextImages: plan.nextImages,
    stage: "PREFLIGHT",
    deploymentUuid: null,
    status: "NOT_DEPLOYED",
  };
  const save = async (stage, status = receipt.status) => {
    receipt.stage = stage;
    receipt.status = status;
    await onReceipt({ ...receipt });
  };
  try {
    await assertAuthority();
    await comparePrevious(plan.previousSourceSha, plan.sourceSha);
    const before = await readSnapshot(api);
    noActiveDeployment(before);
    if (
      protectedSeal(before, secret) !== plan.protectedConfiguration ||
      before.app.status !== "running:healthy" ||
      before.app.config_hash !== plan.previousConfigurationHash ||
      !isDeepStrictEqual(before.images, plan.previousImages)
    )
      throw new DeploymentError(
        "Production changed after planning. No mutation is safe.",
      );
    // A second publisher for the same commit must not automatically redeploy a
    // release already proven running. Reconcile the exact snapshot and health.
    if (isDeepStrictEqual(before.images, plan.nextImages)) {
      const existing = before.history[0];
      if (
        existing.status === "finished" &&
        existing.commit === plan.sourceSha
      ) {
        const record = await api(`/deployments/${existing.deployment_uuid}`);
        if (verifyDeploymentRecord(record, plan)) {
          const migration = await api(
            `/applications/${target.applicationUuid}/logs?service_name=migrate&lines=100&show_timestamps=true`,
          );
          if (
            before.app.status === "running:healthy" &&
            before.app.config_hash === record.configuration_hash &&
            migrationSucceeded(migration.logs, record.created_at)
          ) {
            await externalHealth();
            receipt.deploymentUuid = existing.deployment_uuid;
            receipt.migration = "VERIFIED_EXISTING_RELEASE";
            receipt.containerHealth = "COOLIFY_RUNNING_HEALTHY";
            receipt.configurationHash = record.configuration_hash;
            receipt.externalAvailability = "VERIFIED";
            await save("VERIFIED", "ALREADY_DEPLOYED");
            return receipt;
          }
        }
        throw new DeploymentError(
          "Existing matching release is not verified healthy. Reconcile rather than redeploy automatically.",
        );
      }
    }
    await save("ENV_UPDATE_REQUESTING", "OUTCOME_UNCERTAIN");
    let updateError = false;
    try {
      await api(`/applications/${target.applicationUuid}/envs/bulk`, {
        method: "PATCH",
        body: {
          data: apps.map((app) => ({
            key: imageKeys[app],
            value: plan.nextImages[app],
            is_preview: false,
          })),
        },
      });
    } catch {
      updateError = true;
    }
    // Bulk upsert is not transactional in reviewed Coolify 4.7.3. Read back every
    // image and the protected configuration, even after a refused/lost response.
    const updated = await readSnapshot(api);
    if (
      !isDeepStrictEqual(updated.images, plan.nextImages) ||
      protectedSeal(updated, secret) !== plan.protectedConfiguration ||
      updated.app.config_hash !== plan.previousConfigurationHash
    )
      throw new DeploymentError(
        "Image update is partial, conflicted, or changed protected configuration. No deploy requested.",
      );
    await save(
      updateError ? "ENV_UPDATE_RECONCILED" : "ENV_UPDATE_VERIFIED",
      "UPDATED_NOT_DEPLOYED",
    );
    await assertAuthority();
    noActiveDeployment(updated);
    await save("DEPLOY_REQUESTING", "OUTCOME_UNCERTAIN");
    let queued;
    try {
      queued = await api(`/applications/${target.applicationUuid}/start`, {
        method: "POST",
        body: { force: false, instant_deploy: false },
      });
    } catch {
      /* Reconcile once by reading, never repeat the POST. */
    }
    if (queued?.deployment_uuid && uuidPattern.test(queued.deployment_uuid))
      receipt.deploymentUuid = queued.deployment_uuid;
    else {
      const history = await api(
        `/deployments/applications/${target.applicationUuid}?skip=0&take=20`,
      );
      const fresh = history.deployments?.filter(
        (item) =>
          !plan.previousDeployments.includes(item.deployment_uuid) &&
          item.is_api === true &&
          String(item.application_id) === plan.applicationId,
      );
      if (
        fresh?.length !== 1 ||
        !uuidPattern.test(fresh[0].deployment_uuid ?? "")
      )
        throw new DeploymentError(
          "Deployment request outcome is uncertain. Inspect Coolify; do not retry automatically.",
        );
      receipt.deploymentUuid = fresh[0].deployment_uuid;
    }
    if (plan.previousDeployments.includes(receipt.deploymentUuid))
      throw new DeploymentError("Deployment UUID was reused unexpectedly.");
    await save("DEPLOY_QUEUED", "DEPLOYING");
    for (let attempt = 0; attempt < maxPolls; attempt++) {
      const record = await api(`/deployments/${receipt.deploymentUuid}`);
      if (
        record.deployment_uuid !== receipt.deploymentUuid ||
        String(record.application_id) !== plan.applicationId
      )
        throw new DeploymentError("Coolify returned a different deployment.");
      if (["failed", "cancelled", "cancelled-by-user"].includes(record.status))
        throw new DeploymentError(
          "Coolify deployment failed or was cancelled.",
        );
      if (!["queued", "in_progress", "finished"].includes(record.status))
        throw new DeploymentError(
          "Unknown deployment status; reconcile manually.",
        );
      if (verifyDeploymentRecord(record, plan)) {
        const final = await readSnapshot(api);
        if (
          protectedSeal(final, secret) !== plan.protectedConfiguration ||
          !isDeepStrictEqual(final.images, plan.nextImages)
        )
          throw new DeploymentError(
            "Production configuration drifted during deployment.",
          );
        const migration = await api(
          `/applications/${target.applicationUuid}/logs?service_name=migrate&lines=100&show_timestamps=true`,
        );
        if (
          final.app.status === "running:healthy" &&
          final.app.config_hash === record.configuration_hash &&
          migrationSucceeded(migration.logs, record.created_at)
        ) {
          await externalHealth();
          receipt.migration = "VERIFIED_FRESH_SUCCESS_AND_DEPENDENCY_GATE";
          receipt.containerHealth = "COOLIFY_RUNNING_HEALTHY";
          receipt.configurationHash = record.configuration_hash;
          receipt.externalAvailability = "VERIFIED";
          await save("VERIFIED", "SUCCESS");
          return receipt;
        }
      }
      await wait(10_000);
    }
    throw new DeploymentError(
      "Deployment, fresh migration or healthy-container verification timed out.",
    );
  } catch (error) {
    // Only our fixed diagnostics may cross the receipt/log boundary. An injected
    // transport/library error can contain a token, URL or sensitive body.
    receipt.reason =
      error instanceof DeploymentError
        ? error.message
        : "Authority or external verification failed; sensitive details omitted.";
    const failure = new Error(
      `Production release stopped at ${receipt.stage}. ${receipt.reason} No automatic rollback or mutation retry was made.`,
    );
    await save(
      receipt.stage,
      receipt.status === "NOT_DEPLOYED" ? "BLOCKED" : "RECONCILIATION_REQUIRED",
    );
    throw failure;
  }
}

export async function checkPublicAvailability(fetchImpl = fetch) {
  for (const [url, expected] of [
    [`${target.adminOrigin}/login`, 200],
    [target.invitationOrigin, 200],
    [`${target.adminOrigin}/api/admin/auth/me`, 401],
  ]) {
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: { "Cache-Control": "no-cache" },
      });
    } catch {
      throw new DeploymentError(
        "External HTTPS availability could not be verified.",
      );
    }
    if (response.status !== expected)
      throw new DeploymentError(
        "External HTTPS or protected API availability check failed.",
      );
    if (expected === 401) {
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        throw new DeploymentError("Protected API response is not verifiable.");
      }
      if (envelope.error?.code !== "UNAUTHENTICATED")
        throw new DeploymentError(
          "Protected API did not enforce authentication.",
        );
    }
  }
}
