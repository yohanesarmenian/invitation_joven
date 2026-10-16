import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { resolve } from "node:path";
import { nativeCompose } from "./render-compose.mjs";
import { root, apiRequire } from "../daily/config.mjs";
import { command, dockerBinary } from "../daily/database.mjs";

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const started = Date.now();
const project = `invitation-container-smoke-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const directory = resolve(root, ".local-daily");
await mkdir(directory, { recursive: true });
const composePath = resolve(directory, `${project}.yaml`);
const env = {
  ...process.env,
  COMPOSE_PARALLEL_LIMIT: "1",
  ...apiRequire("dotenv").parse(
    await readFile(resolve(root, "ops/deploy/container-test.env.example")),
  ),
  SOURCE_COMMIT: /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")
    ? process.env.GITHUB_SHA
    : "local-uncommitted",
};
const checks = [];
const record = (name) => {
  checks.push(name);
  console.log(`CONTAINER_VERIFIED ${name}`);
};
let docker,
  allocated = false,
  primaryError;
const args = [
  "compose",
  "--project-directory",
  root,
  "--project-name",
  project,
  "--env-file",
  resolve(root, "ops/deploy/container-test.env.example"),
  "-f",
  composePath,
  "-f",
  resolve(root, "ops/deploy/compose.verify.yaml"),
];
const run = (tail, timeout = 120_000) =>
  command(docker, [...args, ...tail], { cwd: root, env, timeout });
try {
  for (const port of [42700, 42701, 42702]) {
    const server = net.createServer();
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", done);
    });
    await new Promise((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
  docker = await dockerBinary();
  await writeFile(
    composePath,
    nativeCompose(
      await readFile(resolve(root, "compose.coolify.yaml"), "utf8"),
    ),
    { flag: "wx" },
  );
  await run(["config", "--quiet"]);
  record("compose-parses-with-required-synthetic-environment");
  const existing = await command(docker, [
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ]);
  assert(
    existing.trim() === "",
    "Unexpected existing project identity; no resource was taken over.",
  );
  allocated = true;
  for (const service of ["api", "migrate", "admin-web", "invitation-web"]) {
    await run(["build", service], 900_000);
    record(`production-image-built-${service}`);
  }
  record("api-admin-invitation-production-images-built");
  await run(["up", "--detach", "--wait", "--wait-timeout", "180"], 240_000);
  record("migration-completes-before-API-and-all-image-healthchecks-pass");
  const health = await fetch("http://127.0.0.1:42700/health", {
    signal: AbortSignal.timeout(10_000),
  });
  const state = await health.json();
  assert(
    health.ok && state.api === "ok" && state.database === "ok",
    "Container API database health failed.",
  );
  const login = await fetch("http://127.0.0.1:42701/login", {
    signal: AbortSignal.timeout(10_000),
  });
  assert(login.ok, "Production admin login page did not render.");
  const session = await fetch("http://127.0.0.1:42701/api/admin/auth/me", {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  assert(
    session.status === 401,
    "Same-origin admin API rewrite did not reach the protected backend.",
  );
  const invitation = await fetch("http://127.0.0.1:42702/", {
    signal: AbortSignal.timeout(10_000),
  });
  assert(invitation.ok, "Production invitation web did not render.");
  record(
    "production-HTTP-API-health-admin-page-same-origin-rewrite-and-public-page",
  );
  await run([
    "exec",
    "--no-TTY",
    "--workdir",
    "/workspace/apps/api",
    "api",
    "node",
    "node_modules/prisma/build/index.js",
    "migrate",
    "status",
  ]);
  record("production-container-Prisma-migration-history-up-to-date");
  const privileges = await run([
    "exec",
    "--no-TTY",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "invitation_ci",
    "-tAc",
    "SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='invitation_app'",
  ]);
  assert(
    privileges.trim() === "f|f|f",
    "QA application database role has unexpected elevated privileges.",
  );
  record(
    "application-database-role-is-not-superuser-and-cannot-create-roles-or-databases",
  );
  const bootstrapArgs = [
    "exec",
    "--no-TTY",
    "--env",
    "ADMIN_BOOTSTRAP_EMAIL=container-owner@example.invalid",
    "--env",
    "ADMIN_BOOTSTRAP_PASSWORD=synthetic container owner password",
    "api",
    "node",
    "ops/deploy/bootstrap-owner.mjs",
  ];
  assert(
    (await run(bootstrapArgs)).includes("Created OWNER admin user."),
    "Compiled production OWNER bootstrap failed.",
  );
  const refused = await command(docker, [...args, ...bootstrapArgs], {
    cwd: root,
    env,
    expectedFailure: "OWNER bootstrap refused",
    timeout: 30_000,
  });
  assert(
    refused.includes("OWNER bootstrap refused"),
    "Repeated production bootstrap must refuse.",
  );
  const signedIn = await fetch("http://127.0.0.1:42701/api/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: env.ADMIN_ORIGIN },
    body: JSON.stringify({
      email: "container-owner@example.invalid",
      password: "synthetic container owner password",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const cookie = signedIn.headers.get("set-cookie") ?? "";
  assert(
    signedIn.status === 200 &&
      cookie.includes("__Host-admin_session=") &&
      /;\s*Secure(?:;|$)/i.test(cookie) &&
      /;\s*HttpOnly(?:;|$)/i.test(cookie) &&
      !/;\s*Domain=/i.test(cookie),
    "Production OWNER login or host-only secure cookie contract failed.",
  );
  record(
    "compiled-owner-bootstrap-repeat-refusal-and-production-secure-host-only-session",
  );
} catch (error) {
  primaryError = error;
  await writeFile(
    resolve(directory, "container-smoke-failure.txt"),
    error.privateOutput ?? error.message,
  );
} finally {
  if (docker && allocated) {
    try {
      const ids = (
        await command(docker, [
          "ps",
          "--all",
          "--quiet",
          "--filter",
          `label=com.docker.compose.project=${project}`,
        ])
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (ids.length) {
        const owned = JSON.parse(await command(docker, ["inspect", ...ids]));
        assert(
          owned.every(
            (item) =>
              item.Config?.Labels?.["com.docker.compose.project"] === project,
          ),
          "Container cleanup ownership mismatch.",
        );
      }
      await run(["down", "--volumes", "--rmi", "local"]);
      assert(
        (
          await command(docker, [
            "ps",
            "--all",
            "--quiet",
            "--filter",
            `label=com.docker.compose.project=${project}`,
          ])
        ).trim() === "",
        "Container cleanup incomplete.",
      );
      record("exact-owned-QA-stack-removed-no-daily-resource-targeted");
    } catch (error) {
      await writeFile(
        resolve(directory, "container-smoke-cleanup-pending.json"),
        JSON.stringify(
          {
            project,
            composePath,
            reason: "Exact container project cleanup requires review.",
          },
          null,
          2,
        ),
      );
      if (!primaryError) primaryError = error;
    }
  }
}
await writeFile(
  resolve(directory, "container-smoke.json"),
  JSON.stringify(
    {
      project,
      checks,
      status: primaryError ? "failed" : "verified",
      elapsedMs: Date.now() - started,
    },
    null,
    2,
  ),
);
if (primaryError) {
  console.error(
    "Container smoke failed. Inspect private diagnostics and exact owned project; no automatic retry or deployment was made.",
  );
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      status: "verified",
      checks: checks.length,
      elapsedMs: Date.now() - started,
    }),
  );
