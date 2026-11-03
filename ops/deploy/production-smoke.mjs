// Isolated synthetic QA only. No host ports are published.
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { command, dockerBinary } from "../daily/database.mjs";
import { root } from "../daily/config.mjs";

const project = `invitation-production-qa-${randomUUID().slice(0, 8)}`;
const directory = resolve(root, ".local-daily", project);
await mkdir(directory, { recursive: true });
const docker = await dockerBinary();
const password = randomBytes(24).toString("hex");
const env = {
  ...process.env,
  API_IMAGE: `${project}-api`,
  ADMIN_WEB_IMAGE: `${project}-admin-web`,
  INVITATION_WEB_IMAGE: `${project}-invitation-web`,
  POSTGRES_DB: "invitation_ci",
  POSTGRES_PASSWORD: password,
  APP_DATABASE_PASSWORD: password,
  MIGRATOR_DATABASE_PASSWORD: password,
  DATABASE_URL: `postgresql://invitation_app:${password}@postgres:5432/invitation_ci`,
  MIGRATION_DATABASE_URL: `postgresql://invitation_migrator:${password}@postgres:5432/invitation_ci`,
  CREDENTIAL_SECRET: randomBytes(32).toString("base64url"),
  ADMIN_ORIGIN: "https://admin.example.com",
  PUBLIC_INVITATION_BASE_URL: "https://invite.example.com",
};
const args = [
  "compose",
  "--project-directory",
  root,
  "-p",
  project,
  "-f",
  resolve(root, "compose.production.yaml"),
];
const run = (tail, timeout = 120_000) =>
  command(docker, [...args, ...tail], { cwd: root, env, timeout });
let allocated = false;
try {
  await run(["config", "--quiet"]);
  console.log("Verified production Compose with synthetic env.");
  for (const app of ["api", "admin-web", "invitation-web"]) {
    await command(
      docker,
      [
        "build",
        "--platform",
        "linux/amd64",
        "--build-arg",
        `APP=${app}`,
        "--tag",
        `${project}-${app}`,
        ".",
      ],
      { cwd: root, env, timeout: 600_000 },
    );
    const platform = (
      await command(docker, [
        "image",
        "inspect",
        "--format",
        "{{.Os}}/{{.Architecture}}",
        `${project}-${app}`,
      ])
    ).trim();
    if (platform !== "linux/amd64")
      throw Error("Unexpected production image platform.");
    console.log(`Built production ${app} image.`);
  }
  allocated = true;
  await run(["up", "-d", "--wait", "postgres"]);
  console.log(
    (
      await run([
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "postgres",
        "-d",
        "invitation_ci",
        "-tAc",
        "SELECT version(), current_database()",
      ])
    ).trim(),
  );
  const privileges = await run([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "invitation_ci",
    "-tAc",
    "SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='invitation_app'",
  ]);
  if (privileges.trim() !== "f|f|f")
    throw Error("Application role is elevated.");
  const schemaPrivileges = await run([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "invitation_ci",
    "-tAc",
    "SELECT has_schema_privilege('invitation_app','public','CREATE'),has_schema_privilege('invitation_migrator','public','CREATE')",
  ]);
  if (schemaPrivileges.trim() !== "f|t")
    throw Error("Unexpected application/migrator schema privileges.");
  await run(["--profile", "migration", "run", "--rm", "migrate"]);
  await run(
    ["up", "-d", "--wait", "api", "admin-web", "invitation-web"],
    180_000,
  );
  for (const service of ["api", "admin-web", "invitation-web"]) {
    await run(["exec", "-T", service, "node", "ops/deploy/healthcheck.mjs"]);
  }
  await run([
    "exec",
    "-T",
    "admin-web",
    "node",
    "--input-type=module",
    "-e",
    "const r=await fetch('http://127.0.0.1:3001/api/admin/auth/me');if(r.status!==401)process.exit(1)",
  ]);
  console.log(
    "Verified migration gate, restricted role, all image health checks and same-origin auth proxy.",
  );
  await run([
    "exec",
    "-T",
    "postgres",
    "sh",
    "-eu",
    "-c",
    "pg_dump -U postgres -d invitation_ci -Fc -f /tmp/qa.dump; pg_restore --list /tmp/qa.dump >/dev/null; createdb -U postgres -O invitation_migrator invitation_restore_qa; pg_restore -U postgres -d invitation_restore_qa --exit-on-error --no-owner --no-privileges --role=invitation_migrator /tmp/qa.dump",
  ]);
  console.log("Verified custom-format dump and isolated database restore.");
} catch (error) {
  await writeFile(
    resolve(directory, "failure.txt"),
    error.privateOutput ?? error.message,
  );
  console.error(
    `Production QA failed; private diagnostics: ${directory}/failure.txt`,
  );
  process.exitCode = 1;
}

async function cleanup() {
  if (allocated) {
    const ids = (
      await command(docker, [
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length) {
      const owned = JSON.parse(await command(docker, ["inspect", ...ids]));
      if (
        !owned.every(
          (c) => c.Config.Labels["com.docker.compose.project"] === project,
        )
      )
        throw Error("QA cleanup ownership mismatch.");
    }
    await run(["down", "--volumes"]);
    console.log(`Removed only synthetic QA project ${project}.`);
  }
}

try {
  await cleanup();
} catch {
  await writeFile(
    resolve(directory, "cleanup-pending.json"),
    JSON.stringify({ project, args }),
  );
  console.error(
    `QA cleanup requires review: ${directory}/cleanup-pending.json`,
  );
  process.exitCode = 1;
}
