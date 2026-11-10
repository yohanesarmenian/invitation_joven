import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stringify, parse } from "yaml";
import { releaseManifest } from "./image-release.mjs";
import { execute } from "./production-release.mjs";
import { repository, apps, imageKeys } from "./release-authority.mjs";
import {
  target,
  assertCompose,
  validateResource,
  coolifyClient,
  planDeployment,
  deployProduction,
  verifyDeploymentRecord,
  migrationSucceeded,
  checkPublicAvailability,
  DeploymentError,
} from "./coolify-production.mjs";

const sha = "a".repeat(40),
  previous = "b".repeat(40),
  secret = "synthetic-coolify-authority-not-a-real-token";
const source = await readFile(
  new URL("../../compose.production.yaml", import.meta.url),
  "utf8",
);
const manifest = releaseManifest({
  repository,
  sha,
  workflowSha: sha,
  runId: 456,
  runAttempt: 1,
  ciRunId: 123,
  digests: {
    api: `sha256:${"1".repeat(64)}`,
    "admin-web": `sha256:${"2".repeat(64)}`,
    "invitation-web": `sha256:${"3".repeat(64)}`,
  },
});
const nextImages = Object.fromEntries(
  apps.map((app) => [app, manifest.images[app].reference]),
);
const previousImages = Object.fromEntries(
  apps.map((app, i) => [
    app,
    `ghcr.io/${repository}/${app}@sha256:${String(i + 4).repeat(64)}`,
  ]),
);

function fixture(options = {}) {
  const app = {
    config_hash: "4".repeat(64),
    uuid: target.applicationUuid,
    build_pack: "dockercompose",
    destination: {
      uuid: "destination-existing",
      server: { uuid: target.serverUuid },
    },
    git_repository: repository,
    git_branch: "master",
    git_commit_sha: "HEAD",
    base_directory: "/",
    docker_compose_location: target.composeLocation,
    docker_compose_raw: source,
    docker_compose_domains: JSON.stringify({
      "admin-web": { domain: target.adminOrigin },
      "invitation-web": { domain: target.invitationOrigin },
    }),
    settings: {
      is_auto_deploy_enabled: false,
      is_preserve_repository_enabled: true,
      is_raw_compose_deployment_enabled: false,
      is_preview_deployments_enabled: false,
      connect_to_docker_network: false,
    },
    status: "running:healthy",
    additional_servers_count: 0,
  };
  const envs = apps.map((app) => ({
    key: imageKeys[app],
    value: previousImages[app],
    is_preview: false,
    is_literal: true,
    is_shown_once: false,
  }));
  envs.push({
    key: "DATABASE_URL",
    value: "postgresql://private:synthetic-db-password@postgres/db",
    is_preview: false,
  });
  envs.push({
    key: "CREDENTIAL_SECRET",
    value: "synthetic-invitation-signing-secret",
    is_preview: false,
  });
  envs.push({
    key: "CLOUDFLARE_TUNNEL_TOKEN",
    value: "synthetic-tunnel-token",
    is_preview: false,
  });
  const storages = {
    persistent_storages: [
      {
        name: "existing_invitation_postgres_data",
        mount_path: "/var/lib/postgresql",
      },
    ],
    file_storages: [
      {
        mount_path: "/docker-entrypoint-initdb.d/010-roles.sh",
        fs_path: "existing/production-init.sh",
      },
    ],
  };
  const history = [
    {
      deployment_uuid: "previousdeployment0000001",
      application_id: "42",
      status: "finished",
      commit: previous,
      pull_request_id: 0,
      configuration_hash: "4".repeat(64),
    },
  ];
  const calls = [];
  const record = () => ({
    deployment_uuid: "newdeployment000000000001",
    application_id: "42",
    status: "finished",
    commit: sha,
    pull_request_id: 0,
    is_mcp: false,
    is_api: true,
    created_at: "2026-11-07T01:00:00Z",
    restart_only: false,
    rollback: false,
    // Reviewed v4.7.3 still hides configuration_snapshot from the API.
    configuration_hash: "9".repeat(64),
  });
  let posted = false;
  const api = async (path, init = {}) => {
    calls.push({ path, ...init });
    if (init.method === "PATCH") {
      assert.equal(path, `/applications/${target.applicationUuid}/envs/bulk`);
      for (const [index, item] of init.body.data.entries()) {
        if (!options.partial || index === 0)
          envs.find((row) => row.key === item.key).value = item.value;
      }
      if (options.protectedDrift)
        envs.find((row) => row.key === "CREDENTIAL_SECRET").value =
          "unexpected-change";
      if (options.updateLost) throw Error("Simulated transport loss");
      return [];
    }
    if (init.method === "POST") {
      posted = true;
      assert.equal(path, `/applications/${target.applicationUuid}/start`);
      assert.deepEqual(init.body, { force: false, instant_deploy: false });
      if (options.postLost) throw Error("Simulated lost POST response");
      return { deployment_uuid: record().deployment_uuid };
    }
    if (path === "/version") return options.version ?? "4.7.3";
    if (path.endsWith("/envs")) return structuredClone(envs);
    if (path.endsWith("/storages")) return structuredClone(storages);
    if (path.startsWith("/deployments/applications/"))
      return {
        deployments:
          posted && !options.unresolvedPost
            ? [
                { ...record(), status: "in_progress" },
                ...structuredClone(history),
              ]
            : structuredClone(history),
      };
    if (path.includes("/logs?"))
      return {
        logs: options.staleMigration
          ? "2020-01-01T00:00:00Z Prisma migrate deploy succeeded."
          : "2026-11-07T01:00:01.000000000Z Prisma migrate deploy succeeded.",
      };
    if (path.startsWith("/deployments/")) {
      const historical = history.find((item) =>
        path.endsWith("/" + item.deployment_uuid),
      );
      if (historical) return structuredClone(historical);
      return { ...record(), ...options.record };
    }
    if (path === `/applications/${target.applicationUuid}`)
      return {
        ...structuredClone(app),
        config_hash:
          posted && options.record?.status !== "failed"
            ? (options.applicationHash ?? "9".repeat(64))
            : app.config_hash,
      };
    assert.fail("Unexpected Coolify endpoint");
  };
  return { app, envs, storages, history, calls, api, record };
}
async function planned(options = {}) {
  const f = fixture(options),
    receipts = [];
  const plan = await planDeployment({
    manifest,
    api: f.api,
    secret,
    runId: 789,
    assertAuthority: async () => {},
    inspect: async () => ({ revision: previous }),
  });
  const deploy = (overrides) =>
    deployProduction({
      plan,
      manifest,
      api: f.api,
      secret,
      runId: 789,
      assertAuthority: async () => {},
      comparePrevious: async () => {},
      onReceipt: async (r) => receipts.push(structuredClone(r)),
      externalHealth: async () => {},
      wait: async () => {},
      maxPolls: 1,
      ...overrides,
    });
  return { ...f, plan, receipts, deploy };
}

test("production plan captures only immutable rollback refs and keyed integrity, never secrets or raw configuration", async () => {
  const f = await planned();
  assert.deepEqual(f.plan.previousImages, previousImages);
  assert.deepEqual(f.plan.nextImages, nextImages);
  const text = JSON.stringify(f.plan);
  for (const value of [
    secret,
    "synthetic-db-password",
    "synthetic-invitation-signing-secret",
    "synthetic-tunnel-token",
    "docker_compose_raw",
  ])
    assert.ok(!text.includes(value));
  assert.ok(f.calls.every((call) => !call.method));
});

test("reviewed Coolify 4.7.3 supports read-only planning with scoped resource fields", async () => {
  const f = fixture({ version: "v4.7.3" });
  Object.assign(f.app.settings, {
    is_auto_cancel_queued_deployments_enabled: true,
    is_auto_cancel_building_deployments_enabled: false,
    include_network_hosts_in_build: false,
    is_image_scan_enabled: true,
  });
  f.history[0].is_mcp = false;
  let approvals = 0;
  const plan = await planDeployment({
    manifest,
    api: f.api,
    secret,
    runId: 789,
    assertAuthority: async () => {
      approvals++;
    },
    inspect: async () => ({ revision: previous }),
  });
  assert.equal(target.coolifyVersion, "4.7.3");
  assert.equal(approvals, 1);
  assert.deepEqual(plan.previousImages, previousImages);
  assert.ok(f.calls.every((call) => !call.method));
  assert.equal(f.app.destination.server.private_key, undefined);
  assert.equal(f.history[0].configuration_snapshot, undefined);
});

test("unreviewed Coolify versions stop after the version read before resource access or mutation", async () => {
  for (const version of [
    "4.6.0",
    "4.7.2",
    "4.7.4",
    "4.8.0",
    "4.7.3-beta.1",
    "4.7.30",
    "4.7.3+unreviewed",
  ]) {
    const f = fixture({ version });
    await assert.rejects(
      planDeployment({
        manifest,
        api: f.api,
        secret,
        runId: 789,
        assertAuthority: async () => {},
        inspect: async () => ({ revision: previous }),
      }),
      /version differs/,
    );
    assert.deepEqual(f.calls, [{ path: "/version", text: true }]);
  }
});

test("reviewed 4.7.3 settings remain protected against drift after planning", async () => {
  const f = await planned();
  f.app.settings.is_auto_cancel_queued_deployments_enabled = true;
  await assert.rejects(f.deploy(), /Production changed after planning/);
  assert.ok(f.calls.every((call) => !call.method));
});

test("4.7.3 MCP deployments cannot reconcile an uncertain API start", async () => {
  const f = await planned({ postLost: true });
  const api = async (path, init) => {
    const value = await f.api(path, init);
    if (
      path.startsWith("/deployments/applications/") &&
      f.calls.some((call) => call.method === "POST")
    ) {
      return {
        ...value,
        deployments: value.deployments.map((record) => ({
          ...record,
          is_api: false,
          is_mcp: true,
        })),
      };
    }
    return value;
  };
  await assert.rejects(f.deploy({ api }), /outcome is uncertain/);
  assert.deepEqual(
    f.calls.filter((call) => call.method).map((call) => call.method),
    ["PATCH", "POST"],
  );
});

test("Coolify 4.7.3 starting health is never planning or rollout success", async () => {
  const starting = fixture();
  starting.app.status = "running:starting";
  await assert.rejects(
    planDeployment({
      manifest,
      api: starting.api,
      secret,
      runId: 789,
      assertAuthority: async () => {},
      inspect: async () => ({ revision: previous }),
    }),
    /health is not verified/,
  );
  assert.ok(starting.calls.every((call) => !call.method));

  const f = await planned();
  let finalReads = 0;
  let waits = 0;
  let externalChecks = 0;
  const api = async (path, init) => {
    const value = await f.api(path, init);
    if (
      path === `/applications/${target.applicationUuid}` &&
      f.calls.some((call) => call.method === "POST")
    ) {
      finalReads++;
      if (finalReads === 1) return { ...value, status: "running:starting" };
    }
    return value;
  };
  const result = await f.deploy({
    api,
    maxPolls: 2,
    wait: async () => {
      waits++;
      assert.equal(externalChecks, 0);
    },
    externalHealth: async () => {
      externalChecks++;
    },
  });
  assert.equal(result.status, "SUCCESS");
  assert.equal(finalReads, 2);
  assert.equal(waits, 1);
  assert.equal(externalChecks, 1);
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 1);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});

test("successful approved rollout updates precisely three values, posts once and verifies migration and matching applied hashes without hidden snapshots", async () => {
  const f = await planned();
  const beforeProtected = structuredClone(
    f.envs.filter((row) => !Object.values(imageKeys).includes(row.key)),
  );
  const result = await f.deploy();
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.deploymentUuid, "newdeployment000000000001");
  const writes = f.calls.filter((call) => call.method);
  assert.deepEqual(
    writes.map((call) => call.method),
    ["PATCH", "POST"],
  );
  assert.deepEqual(
    writes[0].body.data,
    apps.map((app) => ({
      key: imageKeys[app],
      value: nextImages[app],
      is_preview: false,
    })),
  );
  assert.deepEqual(
    f.envs.filter((row) => !Object.values(imageKeys).includes(row.key)),
    beforeProtected,
  );
  assert.equal(
    f.receipts.at(-1).migration,
    "VERIFIED_FRESH_SUCCESS_AND_DEPENDENCY_GATE",
  );
});

test("unexpected resource, version, source, webhook, volume or migration settings fail before mutation", async () => {
  for (const mutate of [
    (f) => {
      f.app.uuid = "wrongresource000000000000";
    },
    (f) => {
      f.app.destination.server.uuid = "wrongserver00000000000000";
    },
    (f) => {
      f.app.settings.is_auto_deploy_enabled = true;
    },
    (f) => {
      f.app.git_branch = "feature";
    },
    (f) => {
      f.app.git_commit_sha = previous;
    },
    (f) => {
      f.app.additional_servers_count = 1;
    },
    (f) => {
      f.app.docker_compose_custom_start_command =
        "docker compose up -d --no-deps";
    },
    (f) => {
      f.app.docker_compose_raw = source.replace(
        "service_completed_successfully",
        "service_started",
      );
    },
    (f) => {
      f.app.docker_compose_raw = source.replace(
        "invitation_postgres_data:/var/lib/postgresql",
        "new_volume:/var/lib/postgresql",
      );
    },
  ]) {
    const f = fixture();
    mutate(f);
    await assert.rejects(
      planDeployment({
        manifest,
        api: f.api,
        secret,
        runId: 789,
        assertAuthority: async () => {},
        inspect: async () => ({ revision: previous }),
      }),
    );
    assert.ok(f.calls.every((call) => !call.method));
  }
  const f = fixture({ version: "4.7.0" });
  await assert.rejects(
    planDeployment({
      manifest,
      api: f.api,
      secret,
      runId: 789,
      assertAuthority: async () => {},
      inspect: async () => ({ revision: previous }),
    }),
    /version differs/,
  );
});

test("missing approval, old release or plan drift cannot perform any production write", async () => {
  for (const mode of ["approval", "stale", "newer", "drift"]) {
    const f = await planned();
    if (mode === "drift")
      f.envs.find((row) => row.key === "DATABASE_URL").value =
        "changed-private-url";
    await assert.rejects(
      f.deploy({
        assertAuthority: async () => {
          if (["approval", "stale"].includes(mode))
            throw Error("Authority no longer valid");
        },
        comparePrevious: async () => {
          if (mode === "newer") throw Error("Current production is newer");
        },
      }),
    );
    assert.ok(f.calls.every((call) => !call.method));
  }
  const f = await planned();
  await assert.rejects(
    f.deploy({ plan: { ...f.plan, sourceSha: "c".repeat(40) } }),
    /integrity/,
  );
  assert.ok(f.calls.every((call) => !call.method));
});

test("partial bulk update and protected-data drift are detected without deploying or retrying PATCH", async () => {
  for (const options of [
    { partial: true },
    { protectedDrift: true },
    { partial: true, updateLost: true },
  ]) {
    const f = await planned(options);
    await assert.rejects(
      f.deploy(),
      /partial, conflicted, or changed protected/,
    );
    assert.deepEqual(
      f.calls.filter((call) => call.method).map((call) => call.method),
      ["PATCH"],
    );
    assert.equal(f.receipts.at(-1).status, "RECONCILIATION_REQUIRED");
  }
});

test("lost PATCH and deployment responses are reconciled by exact reads without duplicate writes", async () => {
  const f = await planned({ updateLost: true, postLost: true });
  assert.equal((await f.deploy()).status, "SUCCESS");
  assert.deepEqual(
    f.calls.filter((call) => call.method).map((call) => call.method),
    ["PATCH", "POST"],
  );
  const unresolved = await planned({ postLost: true, unresolvedPost: true });
  await assert.rejects(unresolved.deploy(), /outcome is uncertain/);
  assert.equal(
    unresolved.calls.filter((call) => call.method === "POST").length,
    1,
  );
});

test("master moving after env update stops before deployment and retains a reconciliation receipt", async () => {
  const f = await planned();
  let checks = 0;
  await assert.rejects(
    f.deploy({
      assertAuthority: async () => {
        if (++checks === 2) throw new DeploymentError("Stale release");
      },
    }),
    /Stale/,
  );
  assert.deepEqual(
    f.calls.filter((call) => call.method).map((call) => call.method),
    ["PATCH"],
  );
  assert.equal(f.receipts.at(-1).stage, "ENV_UPDATE_VERIFIED");
});

test("finished API status alone is insufficient: wrong source/applied hashes, failed rollout and stale migration all fail", async () => {
  for (const options of [
    { record: { status: "failed" } },
    { record: { commit: previous } },
    { record: { configuration_hash: null } },
    { applicationHash: "7".repeat(64) },
    { staleMigration: true },
  ]) {
    const f = await planned(options);
    await assert.rejects(f.deploy());
    assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
    assert.equal(f.receipts.at(-1).status, "RECONCILIATION_REQUIRED");
  }
  const f = await planned();
  const wrong = f.record();
  wrong.configuration_hash = f.plan.previousConfigurationHash;
  assert.throws(
    () => verifyDeploymentRecord(wrong, f.plan),
    /previous applied configuration/,
  );
});

test("already-deployed exact release is read-reconciled without another PATCH or POST", async () => {
  const f = await planned();
  for (const row of f.envs) {
    const app = apps.find((app) => imageKeys[app] === row.key);
    if (app) row.value = nextImages[app];
  }
  f.history[0] = f.record();
  f.app.config_hash = f.history[0].configuration_hash;
  const plan = await planDeployment({
    manifest,
    api: f.api,
    secret,
    runId: 789,
    assertAuthority: async () => {},
    inspect: async () => ({ revision: sha }),
  });
  assert.equal((await f.deploy({ plan })).status, "ALREADY_DEPLOYED");
  assert.ok(f.calls.every((call) => !call.method));
});

test("migration proof must be a fresh timestamped success marker", () => {
  assert.equal(
    migrationSucceeded(
      "2026-11-07T01:00:01.000000000Z Prisma migrate deploy succeeded.",
      "2026-11-07T01:00:00Z",
    ),
    true,
  );
  for (const value of [
    "Prisma migrate deploy succeeded.",
    "2020-01-01T01:00:00Z Prisma migrate deploy succeeded.",
    "2026-11-07T01:00:01Z Migration gate failed.",
  ])
    assert.equal(migrationSucceeded(value, "2026-11-07T01:00:00Z"), false);
});

test("Coolify HTTP adapter uses reviewed v4.7.3 endpoints and never exposes token, env response or logs on errors", async () => {
  const calls = [];
  const client = coolifyClient(secret, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          message: `private ${secret}`,
          value: "synthetic-db-password",
        }),
        { status: 403 },
      );
    },
  });
  await assert.rejects(
    client(`/applications/${target.applicationUuid}/envs`),
    (error) =>
      !error.message.includes(secret) &&
      !error.message.includes("synthetic-db-password"),
  );
  assert.equal(
    calls[0].url,
    `${target.coolifyOrigin}/api/v1/applications/${target.applicationUuid}/envs`,
  );
  assert.equal(calls[0].init.redirect, "error");
  await assert.rejects(
    client("/applications/wrong-resource/start", { method: "POST", body: {} }),
    /allowlist/,
  );
  await assert.rejects(
    client(`/applications/${target.applicationUuid}/envs/bulk`, {
      method: "PATCH",
      body: { data: [{ key: "CREDENTIAL_SECRET", value: "unsafe" }] },
    }),
    /Only the three/,
  );
  assert.equal(calls.length, 1);
  assert.throws(() => coolifyClient(""), /authority is missing/);
});

test("read-only availability checks use fixed HTTPS pages and prove the Admin API still requires auth", async () => {
  const calls = [];
  await checkPublicAvailability(async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, "error");
    return url.endsWith("/auth/me")
      ? new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), {
          status: 401,
        })
      : new Response("page", { status: 200 });
  });
  assert.deepEqual(calls, [
    `${target.adminOrigin}/login`,
    target.invitationOrigin,
    `${target.adminOrigin}/api/admin/auth/me`,
  ]);
  await assert.rejects(
    checkPublicAvailability(async () => new Response("page", { status: 200 })),
    /protected API/,
  );
});

test("production Compose volume and migration dependencies remain exactly the repository contract", () => {
  assertCompose(source);
  const copy = parse(source, { merge: true });
  copy.services.postgres.ports = ["5432:5432"];
  assert.throws(() => assertCompose(stringify(copy)), /host-published/);
  const app = fixture().app;
  assert.doesNotThrow(() => validateResource(app));
});

test("missing production activation or token fails before any network or Coolify configuration access", async () => {
  await assert.rejects(
    execute("plan", {
      GITHUB_REPOSITORY: repository,
      GITHUB_REF: "refs/heads/master",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_EVENT_NAME: "workflow_run",
    }),
    /Production is inactive/,
  );
});

test("missing installed applied-hash capability blocks before any mutation", async () => {
  const f = fixture();
  f.app.config_hash = null;
  await assert.rejects(
    planDeployment({
      manifest,
      api: f.api,
      secret,
      runId: 789,
      assertAuthority: async () => {},
      inspect: async () => ({ revision: previous }),
    }),
    /applied configuration hashes/,
  );
  assert.ok(f.calls.every((call) => !call.method));
});

test("routine server status and storage timestamps do not masquerade as protected configuration changes", async () => {
  const f = await planned();
  f.app.destination.server.last_online_at = "2026-11-07T01:00:01Z";
  f.storages.persistent_storages[0].updated_at = "2026-11-07T01:00:01Z";
  assert.equal((await f.deploy()).status, "SUCCESS");
});

test("unexpected transport or library exceptions cannot put secrets into a receipt or public error", async () => {
  const f = await planned();
  await assert.rejects(
    f.deploy({
      externalHealth: async () => {
        throw Error(secret + " synthetic-db-password");
      },
    }),
    (error) =>
      !error.message.includes(secret) &&
      !error.message.includes("synthetic-db-password"),
  );
  const output = JSON.stringify(f.receipts);
  assert.ok(
    !output.includes(secret) && !output.includes("synthetic-db-password"),
  );
  assert.equal(
    f.receipts.at(-1).reason,
    "Authority or external verification failed; sensitive details omitted.",
  );
});
