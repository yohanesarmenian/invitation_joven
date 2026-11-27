import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import * as diagnostic from "./production-preflight-diagnostic.mjs";
import { target } from "./coolify-production.mjs";
import { apps, imageKeys, owner, repository } from "./release-authority.mjs";
import {
  assertDiagnosticAuthority,
  diagnose,
  diagnosticClient,
  diagnosticResult,
  publishDiagnostic,
} from "./production-preflight-diagnostic.mjs";

const workflowPath = ".github/workflows/production-preflight-diagnostic.yml";
const appPath = "/applications/" + target.applicationUuid;
const historyPath =
  "/deployments/applications/" + target.applicationUuid + "?skip=0&take=20";
const sha = "a".repeat(40);
const secret = "synthetic-private-provider-value";
const compose = await readFile(
  new URL("../../compose.production.yaml", import.meta.url),
  "utf8",
);
const env = {
  GITHUB_REPOSITORY: repository,
  GITHUB_REF: "refs/heads/master",
  GITHUB_SHA: sha,
  DIAGNOSTIC_SOURCE_SHA: sha,
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_RUN_ID: "84",
  GITHUB_RUN_ATTEMPT: "1",
  GH_TOKEN: secret,
  COOLIFY_API_TOKEN: secret,
};

function authority() {
  return {
    "/git/ref/heads/master": {
      ref: env.GITHUB_REF,
      object: { type: "commit", sha },
    },
    "/environments/production": {
      id: 7,
      name: "production",
      can_admins_bypass: false,
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
    },
    "/environments/production/deployment-branch-policies": {
      branch_policies: [{ name: "master", type: "branch" }],
    },
    "/actions/runs/84": {
      path: workflowPath,
      head_branch: "master",
      head_repository: { full_name: repository },
      head_sha: sha,
      event: "workflow_dispatch",
      run_attempt: 1,
    },
    "/actions/runs/84/approvals": [
      {
        state: "approved",
        user: owner,
        environments: [{ id: 7, name: "production" }],
      },
    ],
  };
}

function snapshot() {
  return {
    app: {
      uuid: target.applicationUuid,
      destination: {
        uuid: "production-destination",
        server: { uuid: target.serverUuid },
      },
      build_pack: "dockercompose",
      git_repository: repository,
      git_branch: "master",
      base_directory: "/",
      docker_compose_location: target.composeLocation,
      docker_compose_raw: compose,
      docker_compose_domains: JSON.stringify({
        "admin-web": { domain: target.adminOrigin },
        "invitation-web": { domain: target.invitationOrigin },
      }),
      additional_servers_count: 0,
      settings: {
        is_auto_deploy_enabled: false,
        is_preserve_repository_enabled: true,
        is_raw_compose_deployment_enabled: false,
        is_preview_deployments_enabled: false,
        connect_to_docker_network: false,
      },
      status: "running:healthy",
      config_hash: "0".repeat(64),
    },
    envs: [
      ...apps.map((app, i) => ({
        id: i + 1,
        key: imageKeys[app],
        is_preview: false,
        value:
          "ghcr.io/" + repository + "/" + app + "@sha256:" + "0".repeat(64),
      })),
      {
        id: 4,
        key: secret,
        value: secret,
        is_preview: false,
        real_value: secret,
      },
    ],
    storages: {
      persistent_storages: [
        { id: 5, name: secret },
        { id: 6, name: secret + "2" },
      ],
      file_storages: [{ id: 7, content: secret }],
    },
  };
}

function simulatedReads({ change = () => {}, recheck = () => {} } = {}) {
  let current;
  let read = -1;
  let appReads = 0;
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path === "/version") {
      read++;
      appReads = 0;
      current = snapshot();
      change(current, read);
      return target.coolifyVersion;
    }
    if (path === appPath) {
      const app = structuredClone(current.app);
      if (++appReads === 2) recheck(app, read);
      return app;
    }
    if (path === appPath + "/envs") return current.envs;
    if (path === appPath + "/storages") return current.storages;
    if (path === historyPath)
      return {
        deployments: [
          { deployment_uuid: "synthetichistory", application_id: "42" },
        ],
      };
    assert.fail("Unexpected fixture path");
  };
  return { api, calls };
}

function diagnosticFetch(api, currentAuthority = authority) {
  const githubBase = "https://api.github.com/repos/" + repository;
  const coolifyBase = target.coolifyOrigin + "/api/v1";
  return async (url, options) => {
    assert.equal(options.method ?? "GET", "GET");
    assert.equal(options.redirect, "error");
    if (url.startsWith(githubBase))
      return Response.json(currentAuthority()[url.slice(githubBase.length)]);
    assert.ok(url.startsWith(coolifyBase));
    const path = url.slice(coolifyBase.length);
    const body = await api(path);
    return path === "/version" ? new Response(body) : Response.json(body);
  };
}

test("workflow requires a pinned master dispatch with OWNER environment and shared concurrency", async () => {
  const workflow = parse(
    await readFile(new URL("../../" + workflowPath, import.meta.url), "utf8"),
  );
  const deploy = parse(
    await readFile(
      new URL("../../.github/workflows/production-deploy.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ["diagnose"]);
  const job = workflow.jobs.diagnose;
  for (const rule of [
    "github.event_name == 'workflow_dispatch'",
    "github.ref == 'refs/heads/master'",
    "github.sha == inputs.source_sha",
    "github.run_attempt == '1'",
  ])
    assert.ok(job.if.includes(rule));
  assert.equal(job.environment, deploy.jobs.deploy.environment.name);
  assert.deepEqual(job.concurrency, deploy.jobs.deploy.concurrency);
  assert.deepEqual(job.permissions, { actions: "read", contents: "read" });
  const diagnosticStep = job.steps.find(
    (step) =>
      step.run === "node ops/deploy/production-preflight-diagnostic.mjs",
  );
  const maximumNetworkAndDelayMinutes = (10 * 30 + 24 * 20 + 120) / 60;
  assert.ok(diagnosticStep["timeout-minutes"] > maximumNetworkAndDelayMinutes);
  assert.ok(job["timeout-minutes"] >= diagnosticStep["timeout-minutes"] + 5);
  const [checkout] = job.steps;
  assert.deepEqual(checkout.with, {
    ref: "${{ github.sha }}",
    "persist-credentials": false,
  });
  for (const step of job.steps.filter((s) => s.uses))
    assert.match(step.uses, /@[0-9a-f]{40}$/);
  assert.deepEqual(
    job.steps.filter((step) => step.run).map((step) => step.run),
    [
      "pnpm install --frozen-lockfile --ignore-scripts",
      "node ops/deploy/production-preflight-diagnostic.mjs",
    ],
  );
  assert.equal(job.steps.at(-1).with.path, "diagnostic-receipt/result.json");
});

test("runtime requires current master, exact run identity, disabled bypass and recorded OWNER approval", async () => {
  await assertDiagnosticAuthority(env, async (path) => authority()[path]);
  for (const changes of [
    { GITHUB_REF: "refs/heads/other" },
    { GITHUB_REF: "refs/tags/master" },
    { GITHUB_REPOSITORY: "another/repository" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { DIAGNOSTIC_SOURCE_SHA: "b".repeat(40) },
  ]) {
    await assert.rejects(
      assertDiagnosticAuthority({ ...env, ...changes }, () => {
        assert.fail("Invalid launch reached the API");
      }),
      /DIAGNOSTIC_IDENTITY_REJECTED/,
    );
  }
  for (const mutate of [
    (data) => {
      data["/git/ref/heads/master"].object.sha = "b".repeat(40);
    },
    (data) => {
      delete data["/environments/production"].can_admins_bypass;
    },
    (data) => {
      data["/environments/production"].can_admins_bypass = true;
    },
    (data) => {
      data[
        "/environments/production/deployment-branch-policies"
      ].branch_policies[0].name = "*";
    },
    (data) => {
      data["/actions/runs/84"].path = ".github/workflows/production-deploy.yml";
    },
    (data) => {
      data["/actions/runs/84"].head_sha = "b".repeat(40);
    },
    (data) => {
      data["/actions/runs/84/approvals"] = [];
    },
    (data) => {
      data["/actions/runs/84/approvals"][0].user = { ...owner, id: 99 };
    },
  ]) {
    const data = authority();
    mutate(data);
    await assert.rejects(
      assertDiagnosticAuthority(env, async (path) => data[path]),
    );
  }
});

test("only the five approved GET routes reach the fixed origin and redirects are refused", async () => {
  const calls = [];
  const api = diagnosticClient(secret, async (url, options) => {
    calls.push({ url, method: options.method, redirect: options.redirect });
    if (url.endsWith(appPath)) return Response.json(snapshot().app);
    if (url.endsWith(appPath + "/envs")) return Response.json(snapshot().envs);
    if (url.endsWith(appPath + "/storages"))
      return Response.json(snapshot().storages);
    return Response.json({ ok: true });
  });
  for (const method of [
    "PATCH",
    "POST",
    "PUT",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "TRACE",
    "get",
  ])
    await assert.rejects(
      api(appPath, { method }),
      /DIAGNOSTIC_OPERATION_REJECTED/,
    );
  for (const path of [
    appPath + "/start",
    appPath + "/envs/bulk",
    appPath + "/logs",
    "/applications/notapproved/envs",
    appPath + "?anything=1",
    "/deployments/another-target",
    "https://other.example" + appPath,
    "//other.example/version",
    appPath + "/../version",
    appPath + "/%2e%2e/version",
    appPath.replace("/applications/", "/%61pplications/"),
    appPath + "/envs%3fanything=1",
  ])
    await assert.rejects(api(path), /DIAGNOSTIC_OPERATION_REJECTED/);
  assert.deepEqual(calls, []);
  const paths = [
    "/version",
    appPath,
    appPath + "/envs",
    appPath + "/storages",
    historyPath,
  ];
  for (const path of paths) await api(path);
  assert.deepEqual(
    calls,
    paths.map((path) => ({
      url: target.coolifyOrigin + "/api/v1" + path,
      method: "GET",
      redirect: "error",
    })),
  );
  for (const reply of [
    Response.redirect("https://other.example"),
    {
      ok: true,
      redirected: true,
      json: () => assert.fail("Redirect body consumed"),
    },
  ])
    await assert.rejects(
      diagnosticClient(secret, async () => reply)(appPath),
      /^Error: DIAGNOSTIC_READ_FAILED$/,
    );
});

test("stable reads use four snapshots, one bounded pause and a closing application read per sample", async () => {
  const { api, calls } = simulatedReads();
  const delays = [];
  const result = await diagnose(api, async (ms) => delays.push(ms));
  assert.deepEqual(delays, [120_000]);
  assert.equal(result.reads.length, 4);
  assert.equal(calls.length, 24);
  assert.equal(result.comparisons.length, 3);
  for (const { applicationRecheck } of result.reads) {
    assert.deepEqual(Object.keys(applicationRecheck.groups).sort(), [
      "app",
      "compose",
      "destination",
    ]);
    assert.equal(Object.hasOwn(applicationRecheck, "imagesEqual"), false);
    assert.equal(
      Object.hasOwn(applicationRecheck, "protectedSealEqual"),
      false,
    );
  }
  const checks = [
    ...result.reads.map((read) => read.applicationRecheck),
    ...result.comparisons.map((read) => read.checks),
  ];
  assert.ok(
    checks.every(
      (c) =>
        c.bothHealthy &&
        c.healthEqual &&
        c.appliedHashAvailable &&
        c.appliedHashEqual &&
        Object.values(c.groups).every(
          (group) => group.equal && !group.changes.length,
        ),
    ),
  );
  assert.ok(
    result.comparisons.every(
      ({ checks }) => checks.protectedSealEqual && checks.imagesEqual,
    ),
  );
});

test("hash equality requires two observed valid SHA-256 values", async (t) => {
  const valid = "0".repeat(64);
  for (const [name, before, after, expected] of [
    ["both missing", undefined, undefined, null],
    ["one missing", valid, undefined, null],
    ["both null", null, null, null],
    ["empty", "", "", null],
    ["malformed", "z".repeat(64), "z".repeat(64), null],
    ["incorrect types", [valid], [valid], null],
    ["equal", valid, valid, true],
    ["different", valid, "1".repeat(64), false],
  ]) {
    await t.test(name, async () => {
      const { api } = simulatedReads({
        change(s, index) {
          const hash = index === 0 ? before : after;
          if (hash === undefined) delete s.app.config_hash;
          else s.app.config_hash = hash;
        },
        recheck(app) {
          if (after === undefined) delete app.config_hash;
          else app.config_hash = after;
        },
      });
      const result = await diagnose(api, async () => {});
      for (const check of [
        result.comparisons[0].checks,
        result.reads[0].applicationRecheck,
      ]) {
        assert.equal(check.appliedHashAvailable, expected !== null);
        assert.equal(check.appliedHashEqual, expected);
      }
    });
  }
});

test("missing health and destination metadata cannot establish equality", async () => {
  const { api } = simulatedReads({
    change(s) {
      delete s.app.status;
      delete s.app.destination.uuid;
    },
  });
  const result = await diagnose(api, async () => {});
  for (const check of [
    result.comparisons[0].checks,
    result.reads[0].applicationRecheck,
  ]) {
    assert.equal(check.healthAvailable, false);
    assert.equal(check.healthEqual, null);
    assert.equal(check.bothHealthy, null);
    assert.equal(check.groups.destination.available, false);
    assert.equal(check.groups.destination.equal, null);
  }
});

test("missing record IDs preserve env drift without exposing keys or values", async () => {
  const { api } = simulatedReads({
    change(s, index) {
      delete s.envs[3].id;
      if (index > 0) s.envs[3].value += secret;
    },
  });
  const result = await diagnose(api, async () => {});
  const { checks } = result.comparisons[0];
  assert.equal(checks.protectedSealEqual, false);
  assert.ok(checks.groups.envs.changes.includes("GROUP:RECORD_ID_UNAVAILABLE"));
  assert.ok(checks.groups.envs.changes.includes("value:VALUE"));
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("malformed approvals block before any Coolify read", async () => {
  for (const approvals of [
    null,
    {},
    [null],
    [{ state: "approved", user: owner, environments: [null] }],
  ]) {
    const { api, calls } = simulatedReads();
    const data = authority();
    data["/actions/runs/84/approvals"] = approvals;
    const result = await diagnosticResult(
      env,
      diagnosticFetch(api, () => data),
      async () => {},
    );
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.failure.code, "DIAGNOSTIC_AUTHORITY_FAILED");
    assert.equal(calls.length, 0);
  }
});

const samples = ["INITIAL", "IMMEDIATE", "DELAYED", "DELAYED_IMMEDIATE"];

test("failed snapshots preserve prior evidence and never retry the failed read", async (t) => {
  for (const [index, sample] of samples.entries()) {
    await t.test(sample, async () => {
      const { api, calls } = simulatedReads({
        change(s, step) {
          if (step === index) throw Error(secret);
          if (step === 1) s.envs[3].value += secret;
        },
      });
      const result = await diagnosticResult(
        env,
        diagnosticFetch(api),
        async () => {},
      );
      assert.equal(result.status, index ? "PARTIAL" : "BLOCKED");
      assert.deepEqual(result.failure, {
        sample,
        code: "DIAGNOSTIC_SNAPSHOT_FAILED",
      });
      assert.deepEqual(
        result.reads.map((read) => read.sample),
        samples.slice(0, index),
      );
      assert.equal(result.comparisons.length, Math.max(index - 1, 0));
      assert.equal(calls.length, index * 6 + 1);
      if (index === 2) {
        const [{ checks }] = result.comparisons;
        assert.equal(checks.protectedSealEqual, false);
        assert.deepEqual(checks.groups.envs.changes, ["value:VALUE"]);
      }
      assert.ok(!JSON.stringify(result).includes(secret));
    });
  }
});

test("closing application failures preserve the full snapshot comparison and mark the recheck unavailable", async (t) => {
  for (const [index, sample] of samples.entries()) {
    await t.test(sample, async () => {
      const { api, calls } = simulatedReads({
        change(s, step) {
          if (step > 0) s.envs[3].value += secret;
        },
        recheck(_, step) {
          if (step === index) throw Error(secret);
        },
      });
      const result = await diagnosticResult(
        env,
        diagnosticFetch(api),
        async () => {},
      );
      assert.equal(result.status, "PARTIAL");
      assert.deepEqual(result.failure, {
        sample,
        code: "DIAGNOSTIC_APPLICATION_RECHECK_FAILED",
      });
      assert.deepEqual(
        result.reads.map((read) => read.sample),
        samples.slice(0, index + 1),
      );
      assert.equal(result.reads[index].applicationRecheck, null);
      assert.equal(result.comparisons.length, index);
      assert.equal(calls.length, (index + 1) * 6);
      assert.ok(!JSON.stringify(result).includes(secret));
    });
  }
});

test("delay failure keeps immediate comparisons and prevents the delayed pair", async () => {
  const { api, calls } = simulatedReads();
  const result = await diagnosticResult(env, diagnosticFetch(api), async () => {
    throw Error(secret);
  });
  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.failure, {
    sample: "DELAYED",
    code: "DIAGNOSTIC_DELAY_FAILED",
  });
  assert.equal(result.reads.length, 2);
  assert.equal(result.comparisons.length, 1);
  assert.equal(calls.length, 12);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("authority is revalidated after the delay and lost authority blocks further Coolify reads", async (t) => {
  for (const [name, change] of [
    [
      "master",
      (data) => {
        data["/git/ref/heads/master"].object.sha = "b".repeat(40);
      },
    ],
    [
      "workflow identity",
      (data) => {
        data["/actions/runs/84"].path = secret;
      },
    ],
    [
      "OWNER approval",
      (data) => {
        data["/actions/runs/84/approvals"] = [];
      },
    ],
    [
      "environment protection",
      (data) => {
        data["/environments/production"].can_admins_bypass = true;
      },
    ],
  ]) {
    await t.test(name, async () => {
      const { api, calls } = simulatedReads();
      const data = authority();
      const result = await diagnosticResult(
        env,
        diagnosticFetch(api, () => data),
        async () => change(data),
      );
      assert.equal(result.status, "PARTIAL");
      assert.deepEqual(result.failure, {
        sample: "DELAYED",
        code: "DIAGNOSTIC_AUTHORITY_FAILED",
      });
      assert.equal(result.reads.length, 2);
      assert.equal(result.comparisons.length, 1);
      assert.equal(calls.length, 12);
      assert.ok(!JSON.stringify(result).includes(secret));
    });
  }
});

test("master moving while delayed protection is checked blocks the delayed pair", async () => {
  const { api, calls } = simulatedReads();
  let delayed = false;
  const data = authority();
  const fetchFixture = diagnosticFetch(api, () => data);
  const result = await diagnosticResult(
    env,
    async (url, options) => {
      if (delayed && url.endsWith("/environments/production")) {
        data["/git/ref/heads/master"].object.sha = "b".repeat(40);
      }
      return fetchFixture(url, options);
    },
    async () => {
      delayed = true;
    },
  );
  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.failure, {
    sample: "DELAYED",
    code: "DIAGNOSTIC_AUTHORITY_FAILED",
  });
  assert.equal(calls.length, 12);
  assert.equal(result.comparisons.length, 1);
});

test("malformed environment and storage entries fail before projection", async () => {
  for (const change of [
    (s, index) => s.envs.push(index + 10),
    (s, index) => s.storages.file_storages.push(index + 10),
    (s) => s.storages.persistent_storages.push([]),
  ]) {
    const { api } = simulatedReads({
      change(s, index) {
        if (index === 2) change(s, index);
      },
    });
    const result = await diagnosticResult(
      env,
      diagnosticFetch(api),
      async () => {},
    );
    assert.equal(result.status, "PARTIAL");
    assert.deepEqual(result.failure, {
      sample: "DELAYED",
      code: "DIAGNOSTIC_SNAPSHOT_FAILED",
    });
    assert.equal(result.comparisons.length, 1);
  }
});

test("unsupported Compose YAML tags cannot emit provider data in warnings", async (t) => {
  const warning = t.mock.method(process, "emitWarning", () => {});
  const { api } = simulatedReads({
    change(s, index) {
      if (index === 2)
        s.app.docker_compose_raw += "\nname: !unsupported " + secret + "\n";
    },
  });
  const result = await diagnosticResult(
    env,
    diagnosticFetch(api),
    async () => {},
  );
  assert.equal(warning.mock.callCount(), 0);
  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.failure, {
    sample: "DELAYED",
    code: "DIAGNOSTIC_SNAPSHOT_FAILED",
  });
  assert.equal(result.comparisons.length, 1);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("storage order is detected without treating the same records as different membership", async () => {
  const { api } = simulatedReads({
    change(s, read) {
      if (read > 0) s.storages.persistent_storages.reverse();
    },
  });
  const { comparisons } = await diagnose(api, async () => {});
  const { groups, protectedSealEqual } = comparisons[0].checks;
  assert.equal(protectedSealEqual, false);
  assert.deepEqual(groups.storages.changes, [
    "persistent_storages:ARRAY_ORDER",
  ]);
  assert.ok(
    [groups.app, groups.destination, groups.compose, groups.envs].every(
      (group) => group.equal,
    ),
  );
});

test("authorized entry point performs only GETs and reports validated Compose differences", async () => {
  const githubBase = "https://api.github.com/repos/" + repository;
  const coolifyBase = target.coolifyOrigin + "/api/v1";
  const { api, calls } = simulatedReads({
    change(s, read) {
      if (read > 0) {
        s.app.docker_compose_raw = compose.replace(
          "  migrate:\n",
          "  migrate:\n    exclude_from_hc: true\n",
        );
      }
    },
  });
  const result = await diagnosticResult(
    env,
    async (url, options) => {
      assert.equal(options.method ?? "GET", "GET");
      assert.equal(options.redirect, "error");
      if (url.startsWith(githubBase))
        return Response.json(authority()[url.slice(githubBase.length)]);
      assert.ok(url.startsWith(coolifyBase));
      const path = url.slice(coolifyBase.length);
      const body = await api(path);
      return path === "/version" ? new Response(body) : Response.json(body);
    },
    async () => {},
  );
  assert.equal(result.status, "OBSERVATIONS_CAPTURED");
  assert.equal(calls.length, 24);
  const { checks } = result.comparisons[0];
  assert.equal(checks.protectedSealEqual, false);
  assert.deepEqual(checks.groups.compose.changes, [
    "services.migrate.exclude_from_hc:PRESENCE",
  ]);
  assert.ok(
    [checks.groups.app, checks.groups.storages, checks.groups.envs].every(
      (group) => group.equal,
    ),
  );
});

test("nested field groups, record types, membership, duplicate identities, and bracket drift are sanitized", async () => {
  const { api } = simulatedReads({
    change(s, read) {
      if (read === 0) return;
      s.app.status = "running:unhealthy";
      s.app.config_hash = "1".repeat(64);
      s.app.settings.created_at = null;
      s.app.settings[secret] = { [secret]: secret };
      s.app.destination.uuid += secret;
      s.envs[0].value = s.envs[0].value.replace(/0{64}$/, "1".repeat(64));
      s.envs[3].real_value = { [secret]: secret };
      s.envs.push({ ...s.envs[3], id: 9 });
      s.storages.file_storages[0].content += secret;
      s.storages.persistent_storages.push({
        ...s.storages.persistent_storages[0],
      });
    },
    recheck(app, read) {
      if (read === 0) app.settings.disable_build_cache = true;
    },
  });
  const result = await diagnose(api, async () => {});
  assert.match(
    JSON.stringify(result.reads[0].applicationRecheck.groups.app),
    /settings.disable_build_cache:PRESENCE/,
  );
  const { checks } = result.comparisons[0];
  assert.equal(checks.healthEqual, false);
  assert.equal(checks.bothHealthy, false);
  assert.equal(checks.appliedHashEqual, false);
  assert.equal(checks.imagesEqual, false);
  assert.equal(checks.protectedSealEqual, false);
  assert.deepEqual(checks.groups.app.changes, [
    "settings.OTHER:PRESENCE",
    "settings.created_at:PRESENCE",
  ]);
  assert.deepEqual(checks.groups.destination.changes, ["uuid:VALUE"]);
  assert.ok(checks.groups.compose.equal);
  assert.deepEqual(checks.groups.storages.changes, [
    "file_storages.content:VALUE",
    "persistent_storages:ARRAY_MEMBERSHIP",
    "persistent_storages:DUPLICATE_RECORD_ID",
  ]);
  assert.deepEqual(checks.groups.envs.changes, [
    "GROUP:ARRAY_MEMBERSHIP",
    "GROUP:DUPLICATE_SORT_IDENTITY",
    "real_value:TYPE",
  ]);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test("malformed data and transport errors produce only a fixed stage code", async () => {
  for (const mode of [
    "authority",
    "version",
    "transport",
    "shape",
    "identity",
  ]) {
    const data = authority();
    if (mode === "authority") data["/actions/runs/84/approvals"] = [];
    const result = await diagnosticResult(
      env,
      async (url) => {
        if (url.startsWith("https://api.github.com/repos/" + repository))
          return Response.json(
            data[
              url.slice(("https://api.github.com/repos/" + repository).length)
            ],
          );
        if (mode === "authority")
          assert.fail("Missing approval reached Coolify");
        if (mode === "transport") throw Error(secret);
        if (url.endsWith("/version"))
          return new Response(
            mode === "version" ? secret : target.coolifyVersion,
          );
        const { app } = snapshot();
        if (mode === "identity") app.uuid = secret;
        return Response.json(
          url.endsWith(appPath) ? app : { [secret]: secret },
        );
      },
      async () => {},
    );
    assert.deepEqual(result, {
      status: "BLOCKED",
      delayMs: 120_000,
      failure: {
        sample: "INITIAL",
        code:
          mode === "authority"
            ? "DIAGNOSTIC_AUTHORITY_FAILED"
            : "DIAGNOSTIC_SNAPSHOT_FAILED",
      },
      reads: [],
      comparisons: [],
    });
  }
});

test("published summary and artifact contain the same sanitized observations and no raw snapshots", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "production-diagnostic-synthetic-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const receipt = join(dir, "receipt");
  const summary = join(dir, "summary.md");
  const { api } = simulatedReads({
    change(s, read) {
      if (read > 0) s.envs[3].value += secret;
    },
  });
  const result = await diagnose(api, async () => {});
  await publishDiagnostic(result, summary, receipt);
  assert.deepEqual(await readdir(receipt), ["result.json"]);
  const artifact = await readFile(join(receipt, "result.json"), "utf8");
  const markdown = await readFile(summary, "utf8");
  assert.deepEqual(JSON.parse(artifact), result);
  assert.ok(markdown.includes(artifact));
  assert.ok(!markdown.includes(secret) && !markdown.includes("ghcr.io/"));
  assert.ok(markdown.includes("value:VALUE"));
});

test("CLI exit status, artifact and summary reflect complete, partial and blocked runs", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "production-diagnostic-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [status, failedAt, exitCode] of [
    ["OBSERVATIONS_CAPTURED", -1, 0],
    ["PARTIAL", 2, 1],
    ["BLOCKED", 0, 1],
  ]) {
    const directory = join(dir, status);
    const summary = join(dir, status + ".md");
    const errors = [];
    const { api } = simulatedReads({
      change(s, index) {
        if (index === failedAt) throw Error(secret);
        if (index === 1) s.envs[3].real_value += secret;
      },
    });
    const code = await diagnostic.runDiagnosticCli(
      { ...env, GITHUB_STEP_SUMMARY: summary },
      {
        fetchImpl: diagnosticFetch(api),
        wait: async () => {},
        directory,
        reportError: (msg) => errors.push(msg),
      },
    );
    assert.equal(code, exitCode);
    assert.deepEqual(errors, exitCode ? ["DIAGNOSTIC_SNAPSHOT_FAILED"] : []);
    assert.deepEqual(await readdir(directory), ["result.json"]);
    const content = await readFile(join(directory, "result.json"), "utf8");
    const markdown = await readFile(summary, "utf8");
    const report = JSON.parse(content);
    assert.equal(report.status, status);
    assert.ok(markdown.includes(content));
    if (status === "PARTIAL") {
      assert.equal(report.comparisons.length, 1);
      assert.deepEqual(report.comparisons[0].checks.groups.envs.changes, [
        "real_value:VALUE",
      ]);
    }
    assert.ok(!markdown.includes(secret) && !markdown.includes("ghcr.io/"));
  }
});

test("artifact and summary write failures stay unsuccessful and hide exception details", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "production-diagnostic-output-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const failArtifact of [true, false]) {
    const directory = join(
      dir,
      failArtifact ? "artifact-failure" : "summary-failure",
    );
    await mkdir(directory);
    const artifactPath = join(directory, "result.json");
    const summary = failArtifact ? join(dir, "never-created.md") : directory;
    if (failArtifact) await writeFile(artifactPath, "{}");
    const errors = [];
    const { api } = simulatedReads();
    const code = await diagnostic.runDiagnosticCli(
      { ...env, GITHUB_STEP_SUMMARY: summary },
      {
        fetchImpl: diagnosticFetch(api),
        wait: async () => {},
        directory,
        reportError: (msg) => errors.push(msg),
      },
    );
    assert.equal(code, 1);
    assert.deepEqual(errors, ["DIAGNOSTIC_OUTPUT_FAILED"]);
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    if (failArtifact) {
      assert.deepEqual(artifact, {});
      const markdown = await readFile(summary, "utf8");
      assert.match(markdown, /OBSERVATIONS_CAPTURED/);
      assert.ok(!markdown.includes(secret));
      assert.deepEqual(await readdir(directory), ["result.json"]);
    } else {
      assert.equal(artifact.status, "OBSERVATIONS_CAPTURED");
      assert.ok(!JSON.stringify(artifact).includes(secret));
    }
  }
});
