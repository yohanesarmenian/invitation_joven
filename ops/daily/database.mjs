import { access, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";
import {
  root,
  rootIdentity,
  configPath,
  apiRequire,
  dailyEnvironment,
  redactDailyOutput,
} from "./config.mjs";

export async function command(binary, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      exceeded = false;
    const collect = (data) => {
      if (exceeded) return;
      const chunk = data.toString();
      if (output.length + chunk.length > 4 * 1024 * 1024) {
        exceeded = true;
        child.kill();
      } else output += chunk;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      exceeded = true;
      child.kill();
    }, options.timeout ?? 120_000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(Error("Required local command could not start."));
    });
    // close follows stdio drain; exit can precede the final verification label.
    child.once("close", (code) => {
      clearTimeout(timer);
      if (
        !exceeded &&
        code !== 0 &&
        options.expectedFailure &&
        output.includes(options.expectedFailure)
      )
        done(output);
      else if (exceeded || code !== 0) {
        const failure = Error(
          "Local command failed; no automatic destructive recovery was attempted.",
        );
        // Explicit callers may retain diagnostics privately. Ordinary error
        // serialization/CLI messages never enumerate or print captured output.
        Object.defineProperty(failure, "privateOutput", { value: output });
        reject(failure);
      } else done(output);
    });
  });
}
export async function dockerBinary() {
  if (process.env.DOCKER_BIN) return process.env.DOCKER_BIN;
  const windows = "C:/Program Files/Docker/Docker/resources/bin/docker.exe";
  if (process.platform === "win32") {
    try {
      await access(windows);
      return windows;
    } catch {
      /* Resolve ordinary PATH below. */
    }
  }
  return "docker";
}
export async function assertNoExistingDailyResources() {
  const project = `invitation-daily-${rootIdentity}`;
  const docker = await dockerBinary();
  const containers = await command(docker, [
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ]);
  const volumes = await command(docker, [
    "volume",
    "ls",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ]);
  if (containers.trim() || volumes.trim())
    throw Error(
      "Daily resources already exist but original configuration is unavailable. Restore its private configuration; no replacement secret was generated.",
    );
}
export async function assertConfigurationCreationAllowed() {
  try {
    await access(configPath);
    return;
  } catch (error) {
    if (error.code !== "ENOENT")
      throw Error(
        "Daily configuration accessibility is unresolved; creation refused.",
      );
  }
  // This read-only preflight precedes even config creation. A missing config
  // alongside retained Compose resources is recovery, never a fresh profile.
  await assertNoExistingDailyResources();
}
function dockerEnv(config) {
  return {
    ...process.env,
    DAILY_COMPOSE_PROJECT: config.project,
    DAILY_ROOT_ID: rootIdentity,
    DAILY_PROFILE_ID: config.profileId,
    DAILY_OPERATOR_PASSWORD: config.operatorPassword,
    DAILY_PG_PORT: String(config.DAILY_PG_PORT),
  };
}
export async function compose(config, args) {
  return command(
    await dockerBinary(),
    [
      "compose",
      "-f",
      resolve(root, "compose.daily.yaml"),
      "--project-name",
      config.project,
      ...args,
    ],
    { env: dockerEnv(config) },
  );
}
export async function ownedContainer(config) {
  const ids = (await compose(config, ["ps", "--all", "--quiet", "postgres"]))
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) return null;
  if (ids.length !== 1 || !/^[a-f0-9]{12,64}$/.test(ids[0]))
    throw Error("Daily container identity is ambiguous.");
  const inspected = JSON.parse(
    await command(await dockerBinary(), ["inspect", ids[0]]),
  );
  const item = inspected[0],
    labels = item?.Config?.Labels;
  const binding = item?.HostConfig?.PortBindings?.["5432/tcp"];
  if (
    inspected.length !== 1 ||
    item.Id !== ids[0] ||
    labels?.["com.docker.compose.project"] !== config.project ||
    labels?.["com.docker.compose.service"] !== "postgres" ||
    labels?.["invitation.daily.root"] !== rootIdentity ||
    labels?.["invitation.daily.profile"] !== config.profileId ||
    binding?.length !== 1 ||
    binding[0].HostIp !== "127.0.0.1" ||
    binding[0].HostPort !== String(config.DAILY_PG_PORT)
  )
    throw Error(
      "Existing daily container does not match this profile. It was not changed.",
    );
  return {
    id: item.Id,
    running: item.State.Running,
    healthy: item.State.Health?.Status === "healthy",
    volume: item.Mounts?.find(
      (mount) =>
        mount.Type === "volume" && mount.Destination === "/var/lib/postgresql",
    )?.Name,
  };
}
export async function assertPortsAvailable(ports) {
  for (const port of ports)
    await new Promise((done, reject) => {
      const probe = net.createServer();
      probe.once("error", () =>
        reject(
          Error(
            `Daily port ${port} is occupied or unavailable. No existing process was stopped.`,
          ),
        ),
      );
      probe.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
        probe.close(done),
      );
    });
}
export function pgClient(url) {
  const { Client } = apiRequire("pg");
  return new Client({
    connectionString: url,
    connectionTimeoutMillis: 3000,
    statement_timeout: 10_000,
    options: "-c timezone=UTC",
  });
}
export async function withClient(url, action) {
  const client = pgClient(url);
  try {
    await client.connect();
    return await action(client);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Daily "))
      throw error;
    throw Error(
      "Daily PostgreSQL operation failed. Check database health/configuration; diagnostic contents omitted.",
    );
  } finally {
    await client.end().catch(() => {});
  }
}
export async function assertDatabase(config) {
  const container = await ownedContainer(config);
  if (!container?.running || !container.volume)
    throw Error(
      "Daily database container is not running or its volume identity is missing.",
    );
  const identity = await withClient(config.databaseUrl, async (client) => {
    const row = (
      await client.query(
        "SELECT current_database() AS name, current_user AS role, r.rolsuper, r.rolcreatedb, r.rolcreaterole, shobj_description(d.oid,'pg_database') AS marker FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()",
      )
    ).rows[0];
    if (
      row?.name !== config.database ||
      row.role !== config.role ||
      row.rolsuper ||
      row.rolcreatedb ||
      row.rolcreaterole ||
      row.marker !== config.marker
    )
      throw Error(
        "Daily database/role/secret identity mismatch. No reset or reissue was attempted.",
      );
    return {
      database: row.name,
      role: row.role,
      volume: container.volume,
      container: container.id,
    };
  });
  return identity;
}
export async function assertMigrations(config) {
  const directories = (
    await readdir(resolve(root, "apps/api/prisma/migrations"), {
      withFileTypes: true,
    })
  )
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();
  const expected = await Promise.all(
    directories.map(async (name) => ({
      name,
      hash: createHash("sha256")
        .update(
          await readFile(
            resolve(root, "apps/api/prisma/migrations", name, "migration.sql"),
          ),
        )
        .digest("hex"),
    })),
  );
  return withClient(config.databaseUrl, async (client) => {
    const applied = (
      await client.query(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"',
      )
    ).rows;
    if (
      applied.length !== expected.length ||
      expected.some(
        (item) =>
          !applied.some(
            (row) =>
              row.migration_name === item.name &&
              row.checksum === item.hash &&
              row.finished_at &&
              !row.rolled_back_at,
          ),
      )
    )
      throw Error(
        "Daily migration history is missing or differs from this source. Run local:init after review; no reset was attempted.",
      );
    return expected.length;
  });
}
export async function initializeDatabase(config) {
  const existing = await ownedContainer(config);
  if (!existing?.running) {
    await assertPortsAvailable([config.DAILY_PG_PORT]);
    await compose(config, [
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "90",
      "postgres",
    ]);
  }
  const owned = await ownedContainer(config);
  if (!owned?.running || !owned.volume)
    throw Error("Daily PostgreSQL identity is unavailable after startup.");
  await withClient(config.operatorUrl, async (client) => {
    await client.query("SELECT pg_advisory_lock(8001320001)");
    try {
      const role = (
        await client.query(
          "SELECT oid, rolsuper,rolcreatedb,rolcreaterole,shobj_description(oid,'pg_authid') AS marker FROM pg_roles WHERE rolname=$1",
          [config.role],
        )
      ).rows[0];
      if (
        role &&
        (role.rolsuper ||
          role.rolcreatedb ||
          role.rolcreaterole ||
          role.marker !== config.marker)
      )
        throw Error(
          "Daily application role already exists with a different identity.",
        );
      if (!role) {
        await client.query("BEGIN");
        await client.query(
          `CREATE ROLE ${config.role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${config.databasePassword}'`,
        );
        await client.query(
          `COMMENT ON ROLE ${config.role} IS '${config.marker}'`,
        );
        await client.query("COMMIT");
      }
      const database = (
        await client.query(
          "SELECT oid,pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1",
          [config.database],
        )
      ).rows[0];
      if (
        database &&
        (database.owner !== config.role || database.marker !== config.marker)
      )
        throw Error("Daily database already exists with a different identity.");
      if (!database) {
        await client.query(
          `CREATE DATABASE ${config.database} OWNER ${config.role}`,
        );
        await client.query(
          `COMMENT ON DATABASE ${config.database} IS '${config.marker}'`,
        );
      }
    } finally {
      await client
        .query("SELECT pg_advisory_unlock(8001320001)")
        .catch(() => {});
    }
  });
  await assertDatabase(config);
  const prisma = resolve(
    apiRequire.resolve("prisma/package.json"),
    "../build/index.js",
  );
  const output = await command(
    process.execPath,
    [prisma, "migrate", "deploy"],
    { cwd: resolve(root, "apps/api"), env: dailyEnvironment(config) },
  );
  console.log(redactDailyOutput(output, config).trim());
  return assertMigrations(config);
}
export async function stopDatabase(config) {
  const owned = await ownedContainer(config);
  if (owned?.running)
    await command(await dockerBinary(), ["stop", "--time", "10", owned.id]);
}
