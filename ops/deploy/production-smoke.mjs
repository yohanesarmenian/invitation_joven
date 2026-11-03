// Isolated synthetic QA only. No host ports are published.
import { cp, mkdir, writeFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { command, dockerBinary } from "../daily/database.mjs";
import { root } from "../daily/config.mjs";

const project = `invitation-production-qa-${randomUUID().slice(0, 8)}`;
const directory = resolve(root, ".local-daily", project);
await mkdir(directory, { recursive: true });
const docker = await dockerBinary();
const password = randomBytes(24).toString("hex");
const appPassword = randomBytes(24).toString("hex");
const migratorPassword = randomBytes(24).toString("hex");
const env = {
  ...process.env,
  API_IMAGE: `${project}-api`,
  ADMIN_WEB_IMAGE: `${project}-admin-web`,
  INVITATION_WEB_IMAGE: `${project}-invitation-web`,
  POSTGRES_DB: "invitation_ci",
  POSTGRES_PASSWORD: password,
  APP_DATABASE_PASSWORD: appPassword,
  MIGRATOR_DATABASE_PASSWORD: migratorPassword,
  DATABASE_URL: `postgresql://invitation_app:${appPassword}@postgres:5432/invitation_ci`,
  MIGRATION_DATABASE_URL: `postgresql://invitation_migrator:${migratorPassword}@postgres:5432/invitation_ci`,
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
  for (const name of [
    "API_IMAGE",
    "MIGRATION_DATABASE_URL",
    "DATABASE_URL",
    "CREDENTIAL_SECRET",
  ]) {
    let rejected = false;
    try {
      await command(docker, [...args, "config", "--quiet"], {
        env: { ...env, [name]: "" },
      });
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error(`Missing required ${name} did not fail closed.`);
  }
  console.log("Verified missing image/credential variables fail closed.");
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
    const user = (
      await command(docker, [
        "image",
        "inspect",
        "--format",
        "{{.Config.User}}",
        `${project}-${app}`,
      ])
    ).trim();
    if (user !== "node") throw Error("Production image is not non-root.");
    console.log(`Built production ${app} image: ${platform}, user=${user}.`);
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
  // Real failed Prisma migration in a separate disposable database. Never edit
  // approved source migrations and never reset/resolve a production database.
  await run([
    "exec",
    "-T",
    "postgres",
    "createdb",
    "-U",
    "postgres",
    "-O",
    "invitation_migrator",
    "invitation_failure_qa",
  ]);
  const migrationDirectory = resolve(directory, "failure-migrations");
  await cp(resolve(root, "apps/api/prisma/migrations"), migrationDirectory, {
    recursive: true,
  });
  await mkdir(resolve(migrationDirectory, "20990101000000_qa_failure"));
  await writeFile(
    resolve(migrationDirectory, "20990101000000_qa_failure/migration.sql"),
    "SELECT * FROM deliberately_missing_qa_relation;\n",
  );
  const override = resolve(directory, "failure.yaml");
  await writeFile(
    override,
    JSON.stringify({
      services: {
        migrate: {
          volumes: [
            {
              type: "bind",
              source: migrationDirectory,
              target: "/workspace/apps/api/prisma/migrations",
              read_only: true,
            },
          ],
        },
      },
    }),
  );
  const failureEnv = {
    ...env,
    DATABASE_URL: env.DATABASE_URL.replace(
      "/invitation_ci",
      "/invitation_failure_qa",
    ),
    MIGRATION_DATABASE_URL: env.MIGRATION_DATABASE_URL.replace(
      "/invitation_ci",
      "/invitation_failure_qa",
    ),
  };
  let migrationRejected = false;
  try {
    await command(
      docker,
      [
        ...args,
        "-f",
        override,
        "up",
        "-d",
        "api",
        "admin-web",
        "invitation-web",
      ],
      { cwd: root, env: failureEnv, timeout: 180_000 },
    );
  } catch {
    migrationRejected = true;
  }
  if (!migrationRejected)
    throw Error("Failed migration unexpectedly allowed Compose startup.");
  const failedRows = (
    await run([
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "invitation_failure_qa",
      "-tAc",
      "SELECT count(*) FROM _prisma_migrations WHERE migration_name='20990101000000_qa_failure' AND finished_at IS NULL AND logs IS NOT NULL",
    ])
  ).trim();
  if (failedRows !== "1")
    throw Error("Failure was not a real recorded Prisma migration failure.");
  for (const service of ["api", "admin-web", "invitation-web"]) {
    const ids = (await run(["ps", "-a", "-q", service])).trim();
    if (ids) {
      const containers = JSON.parse(
        await command(docker, ["inspect", ...ids.split(/\s+/)]),
      );
      if (containers.some((c) => c.State.StartedAt !== "0001-01-01T00:00:00Z"))
        throw Error(`Failed migration allowed ${service} to start.`);
    }
  }
  console.log(
    "REAL FAILURE PASS: Prisma SQL failure recorded; Compose rejected rollout; all three apps never started.",
  );
  await run(["rm", "-f", "api", "admin-web", "invitation-web", "migrate"]);

  // A competing migrator must fail while another session holds the release lock.
  const holder = `${project}-lock-holder`;
  await run([
    "exec",
    "-d",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "invitation_ci",
    "-c",
    `SET application_name='${holder}'; SELECT pg_advisory_lock(1783901285,1); SELECT pg_sleep(120);`,
  ]);
  let locked = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = (
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
        `SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.granted AND a.application_name='${holder}'`,
      ])
    ).trim();
    if (value === "1") {
      locked = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!locked) throw Error("QA lock holder did not acquire advisory lock.");
  let competitorRejected = false;
  try {
    await run(["run", "--rm", "migrate"]);
  } catch {
    competitorRejected = true;
  }
  if (!competitorRejected)
    throw Error("Concurrent migrator bypassed the release lock.");
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
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${holder}'`,
  ]);
  console.log(
    "REAL CONCURRENCY PASS: competing migration rejected while PostgreSQL release lock is held.",
  );
  // No separate manual gate: ordinary Compose startup must run migration first.
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
    "Verified dependency-enforced migration, restricted role, all image health checks and same-origin auth proxy.",
  );
  await run([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "invitation_ci",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "SET ROLE invitation_migrator; CREATE TABLE public.deployment_qa_sentinel (id integer PRIMARY KEY); INSERT INTO public.deployment_qa_sentinel VALUES (42);",
  ]);
  await run([
    "exec",
    "-T",
    "api",
    "node",
    "--input-type=module",
    "-e",
    "import {createRequire} from 'node:module';const require=createRequire(new URL('./apps/api/package.json', 'file:///workspace/'));const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});try{await c.connect();if((await c.query('SELECT current_user AS role')).rows[0].role!=='invitation_app')throw Error();await c.query('UPDATE deployment_qa_sentinel SET id=43 WHERE id=42');if((await c.query('SELECT id FROM deployment_qa_sentinel')).rows[0]?.id!==43)throw Error();if((await c.query('DELETE FROM deployment_qa_sentinel WHERE id=43')).rowCount!==1)throw Error();await c.query('INSERT INTO deployment_qa_sentinel VALUES (44)');let refused=false;try{await c.query('CREATE TABLE public.forbidden_qa_ddl (id integer)')}catch(e){refused=e.code==='42501'}if(!refused)throw Error()}catch{process.exitCode=1}finally{await c.end()}",
  ]);
  await run(["run", "--rm", "migrate"]);
  const sentinel = (
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
      "SELECT id FROM deployment_qa_sentinel",
    ])
  ).trim();
  if (sentinel !== "44")
    throw Error("Repeated migration did not preserve synthetic data.");
  const metadataAccess = (
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
      "SELECT has_table_privilege('invitation_app','public._prisma_migrations','SELECT,INSERT,UPDATE,DELETE')",
    ])
  ).trim();
  if (metadataAccess !== "f")
    throw Error("Runtime can access migration history.");
  let runtimeRoleRejected = false;
  try {
    await command(docker, [...args, "run", "--rm", "migrate"], {
      env: { ...env, MIGRATION_DATABASE_URL: env.DATABASE_URL },
      timeout: 120_000,
    });
  } catch {
    runtimeRoleRejected = true;
  }
  if (!runtimeRoleRejected)
    throw Error("Migration gate accepted runtime application credentials.");
  console.log(
    "REAL PRIVILEGE PASS: app CRUD succeeds, DDL denied (42501), migration metadata denied, runtime-role migration rejected, repeat migration preserves data.",
  );
  await run([
    "exec",
    "-T",
    "api",
    "node",
    "--input-type=module",
    "-e",
    "if(process.env.MIGRATION_DATABASE_URL||!process.env.DATABASE_URL?.includes('invitation_app:'))process.exit(1)",
  ]);
  await run([
    "exec",
    "-T",
    "invitation-web",
    "node",
    "--input-type=module",
    "-e",
    "const r=await fetch('http://api:4000/health');const b=await r.json();if(!r.ok||b.database!=='ok')process.exit(1)",
  ]);
  console.log(
    "Verified runtime migration-credential isolation and internal web-to-API connectivity.",
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
