import { readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  loadDailyConfig,
  parseDailyConfigSource,
  configPath,
} from "./config.mjs";
import {
  assertDatabase,
  assertMigrations,
  ownedContainer,
  withClient,
  pgClient,
} from "./database.mjs";
import { streamArchive } from "./archive-stream.mjs";
import {
  snapshotTables,
  migrationSnapshot,
  identifier,
} from "./backup-snapshot.mjs";
import {
  backupRoot,
  restoreRoot,
  UUID,
  sha256,
  privateDirectory,
  fileDigest,
  readSigned,
  writeSigned,
  regularFile,
  receiptPath,
} from "./backup-storage.mjs";

const fail = (message) => {
  throw Error(`Daily ${message}`);
};
const hash = /^[a-f0-9]{64}$/;
const restoreName = /^invitation_restore_daily_[a-f0-9]{32}$/;
async function sourceConfig(config, migrations = true) {
  const base = await loadDailyConfig();
  const allowed =
    config.database === base.database ||
    (process.env.INVITATION_DAILY_VERIFICATION === "1" &&
      /^invitation_qa_daily_[a-f0-9]{16}$/.test(config.database));
  const expected = new URL(base.databaseUrl);
  expected.pathname = `/${config.database}`;
  const aligned = Object.entries(base).every(
    ([key, value]) =>
      ["database", "databaseUrl"].includes(key) || config[key] === value,
  );
  if (
    !allowed ||
    !aligned ||
    config.fingerprint !== base.fingerprint ||
    config.marker !== base.marker ||
    config.databaseUrl !== expected.toString() ||
    config.operatorUrl !== base.operatorUrl
  )
    fail("backup source identity mismatch.");
  const normalized = {
    ...base,
    database: config.database,
    databaseUrl: expected.toString(),
  };
  await assertDatabase(normalized);
  if (migrations) await assertMigrations(normalized);
  return normalized;
}
const connectionArgs = (config, name) => [
  "--host",
  "127.0.0.1",
  "--port",
  "5432",
  "--username",
  config.role,
  "--dbname",
  name,
];
function validateManifest(m, config) {
  if (
    !m ||
    m.format !== "invitation-backup-v1" ||
    !UUID.test(m.id ?? "") ||
    m.status !== "BACKUP_COMPLETE" ||
    m.fingerprint !== config.fingerprint ||
    m.profileId !== config.profileId ||
    (!["invitation_daily"].includes(m.database) &&
      !/^invitation_qa_daily_[a-f0-9]{16}$/.test(m.database ?? "")) ||
    !Number.isFinite(Date.parse(m.createdAt)) ||
    !Number.isSafeInteger(m.serverMajor) ||
    m.serverMajor < 18 ||
    !Array.isArray(m.tables) ||
    m.tables.length === 0 ||
    m.tables.length > 1024 ||
    !m.tables.every(
      (t) =>
        typeof t.name === "string" &&
        t.name.length <= 63 &&
        Number.isSafeInteger(t.rows) &&
        t.rows >= 0 &&
        hash.test(t.sha256),
    ) ||
    new Set(m.tables.map((t) => t.name)).size !== m.tables.length ||
    !Array.isArray(m.migrations) ||
    m.migrations.length === 0 ||
    !m.migrations.every(
      (t) => typeof t.name === "string" && hash.test(t.sha256),
    ) ||
    !hash.test(m.recovery?.sha256 ?? "") ||
    !hash.test(m.archive?.sha256 ?? "") ||
    !Number.isSafeInteger(m.archive?.bytes) ||
    m.archive.bytes < 5
  )
    fail("backup manifest invalid or belongs to a different configuration.");
  return m;
}
export async function verifyBackup(directory, config = undefined) {
  config ??= await loadDailyConfig();
  directory = resolve(directory);
  if ((await lstat(directory)).isSymbolicLink())
    fail("backup directory must not be a link.");
  const manifest = validateManifest(
    await readSigned(join(directory, "manifest.json"), config),
    config,
  );
  await regularFile(join(directory, "recovery.env"), 8192);
  const recovery = await readFile(join(directory, "recovery.env"), "utf8");
  if (
    sha256(recovery) !== manifest.recovery.sha256 ||
    parseDailyConfigSource(recovery).fingerprint !== config.fingerprint
  )
    fail("backup recovery configuration mismatch.");
  const archive = await fileDigest(join(directory, "database.dump"));
  if (JSON.stringify(archive) !== JSON.stringify(manifest.archive))
    fail("backup archive checksum/size mismatch.");
  // Check the custom archive header without loading its contents into memory.
  const { open } = await import("node:fs/promises");
  const file = await open(join(directory, "database.dump"), "r");
  try {
    const bytes = Buffer.alloc(5);
    await file.read(bytes, 0, 5, 0);
    if (bytes.toString() !== "PGDMP") fail("backup archive format invalid.");
  } finally {
    await file.close();
  }
  return { manifest, directory };
}
export async function createBackup(config = undefined, { signal } = {}) {
  config ??= await loadDailyConfig();
  config = await sourceConfig(config);
  const recovery = await readFile(configPath, "utf8");
  if (parseDailyConfigSource(recovery).fingerprint !== config.fingerprint)
    fail("configuration changed before backup.");
  const id = randomUUID(),
    directory = await privateDirectory(backupRoot, id);
  await writeSigned(
    join(directory, "operation.json"),
    {
      format: "invitation-backup-operation-v1",
      id,
      database: config.database,
      fingerprint: config.fingerprint,
      createdAt: new Date().toISOString(),
    },
    config,
    true,
  );
  await writeFile(join(directory, "recovery.env"), recovery, {
    flag: "wx",
    mode: 0o600,
  });
  const client = pgClient(config.databaseUrl);
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id;
    const serverMajor = Math.floor(
      Number(
        (await client.query("SHOW server_version_num")).rows[0]
          .server_version_num,
      ) / 10000,
    );
    const tables = await snapshotTables(client),
      migrations = await migrationSnapshot(client);
    const container = await ownedContainer(config);
    await streamArchive({
      container: container.id,
      binary: "pg_dump",
      args: [
        ...connectionArgs(config, config.database),
        "--format=custom",
        "--no-owner",
        "--no-acl",
        `--snapshot=${snapshot}`,
      ],
      file: join(directory, "database.dump"),
      password: config.databasePassword,
      signal,
    });
    await client.query("COMMIT");
    if (sha256(await readFile(configPath)) !== sha256(recovery))
      fail("configuration changed during backup; incomplete backup retained.");
    const manifest = {
      format: "invitation-backup-v1",
      id,
      status: "BACKUP_COMPLETE",
      createdAt: new Date().toISOString(),
      profileId: config.profileId,
      fingerprint: config.fingerprint,
      database: config.database,
      serverMajor,
      migrations,
      tables,
      archive: await fileDigest(join(directory, "database.dump")),
      recovery: { sha256: sha256(recovery) },
    };
    validateManifest(manifest, config);
    signal?.throwIfAborted();
    await writeSigned(join(directory, "manifest.json"), manifest, config, true);
    await verifyBackup(directory, config);
    return {
      status: "BACKUP_COMPLETE",
      directory,
      id,
      bytes: manifest.archive.bytes,
      tables: tables.length,
    };
  } catch {
    // An incomplete directory is retained for diagnosis; absence of a signed
    // completed manifest prevents use as a successful backup.
    throw Error(
      `Daily backup failed. Bundle retained at ${directory}; verify its state before reuse. No automatic retry.`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}
function validateReceipt(receipt, config) {
  if (
    !receipt ||
    receipt.format !== "invitation-restore-v1" ||
    !UUID.test(receipt.id ?? "") ||
    receipt.database !==
      `invitation_restore_daily_${receipt.id.replaceAll("-", "")}` ||
    !restoreName.test(receipt.database) ||
    receipt.fingerprint !== config.fingerprint ||
    !UUID.test(receipt.backupId ?? "") ||
    receipt.marker !==
      `invitation-restore-v1:${config.profileId}:${receipt.id}:${receipt.backupId}` ||
    !["ALLOCATING", "RESTORING", "VERIFIED", "FAILED", "REMOVED"].includes(
      receipt.status,
    )
  )
    fail("restore receipt identity invalid.");
  return receipt;
}
async function restoreIdentity(config, receipt, action, allowAbsent = false) {
  validateReceipt(receipt, config);
  await assertDatabase(config);
  return withClient(config.operatorUrl, async (db) => {
    const row = (
      await db.query(
        "SELECT pg_get_userbyid(datdba) AS owner,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=$1",
        [receipt.database],
      )
    ).rows[0];
    if (!row && allowAbsent) return { absent: true };
    if (!row || row.owner !== config.role || row.marker !== receipt.marker)
      fail("restore ownership unresolved; database retained.");
    return action(db);
  });
}
export async function restoreBackup(
  directory,
  config = undefined,
  { signal } = {},
) {
  config ??= await loadDailyConfig();
  config = await sourceConfig(config);
  const { manifest, directory: bundle } = await verifyBackup(directory, config);
  // Refuse incompatible source/migrations BEFORE allocating a target database.
  const current = await withClient(config.databaseUrl, migrationSnapshot);
  const major = await withClient(config.databaseUrl, async (db) =>
    Math.floor(
      Number(
        (await db.query("SHOW server_version_num")).rows[0].server_version_num,
      ) / 10000,
    ),
  );
  if (
    JSON.stringify(current) !== JSON.stringify(manifest.migrations) ||
    major !== manifest.serverMajor
  )
    fail(
      "backup PostgreSQL/migration version mismatch; no restore database created.",
    );
  const id = randomUUID(),
    receiptDirectory = await privateDirectory(restoreRoot, id),
    path = join(receiptDirectory, "receipt.json");
  const receipt = {
    format: "invitation-restore-v1",
    id,
    backupId: manifest.id,
    fingerprint: config.fingerprint,
    database: `invitation_restore_daily_${id.replaceAll("-", "")}`,
    marker: `invitation-restore-v1:${config.profileId}:${id}:${manifest.id}`,
    createdAt: new Date().toISOString(),
    status: "ALLOCATING",
  };
  await writeSigned(path, receipt, config, true);
  try {
    signal?.throwIfAborted();
    await withClient(config.operatorUrl, async (db) => {
      await db.query(
        `CREATE DATABASE ${identifier(receipt.database)} OWNER ${identifier(config.role)}`,
      );
      await db.query(
        `COMMENT ON DATABASE ${identifier(receipt.database)} IS '${receipt.marker}'`,
      );
    });
    await restoreIdentity(config, receipt, async () => {});
    receipt.status = "RESTORING";
    await writeSigned(path, receipt, config);
    const container = await ownedContainer(config);
    await streamArchive({
      container: container.id,
      binary: "pg_restore",
      args: [
        ...connectionArgs(config, receipt.database),
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-acl",
      ],
      file: join(bundle, "database.dump"),
      password: config.databasePassword,
      signal,
    });
    const url = new URL(config.databaseUrl);
    url.pathname = `/${receipt.database}`;
    const restored = await withClient(url.toString(), async (db) => {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        return {
          tables: await snapshotTables(db),
          migrations: await migrationSnapshot(db),
        };
      } finally {
        await db.query("ROLLBACK");
      }
    });
    if (
      JSON.stringify(restored.tables) !== JSON.stringify(manifest.tables) ||
      JSON.stringify(restored.migrations) !==
        JSON.stringify(manifest.migrations)
    )
      fail("restored data does not match backup snapshot.");
    await restoreIdentity(config, receipt, async () => {});
    receipt.status = "VERIFIED";
    signal?.throwIfAborted();
    await writeSigned(path, receipt, config);
    return {
      status: "RESTORE_VERIFIED",
      database: receipt.database,
      receipt: receiptDirectory,
      backupId: manifest.id,
    };
  } catch {
    receipt.status = "FAILED";
    await writeSigned(path, receipt, config).catch(() => {});
    throw Error(
      `Daily restore failed. Receipt retained at ${receiptDirectory}; target state must be checked. Do not retry automatically. Use explicit restore cleanup after review.`,
    );
  }
}
export async function removeRestore(directory, config = undefined) {
  config ??= await loadDailyConfig();
  config = await sourceConfig(config, false);
  directory = resolve(directory);
  const path = await receiptPath(directory),
    receipt = validateReceipt(await readSigned(path, config), config);
  const result = await restoreIdentity(
    config,
    receipt,
    async (db) => {
      if (receipt.status === "REMOVED")
        fail(
          "restore receipt says removed but a database exists; cleanup refused.",
        );
      const clients = (
        await db.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1",
          [receipt.database],
        )
      ).rows[0].count;
      if (clients !== 0)
        fail(
          "restore still has active clients; cleanup refused without terminating them.",
        );
      await db.query(`DROP DATABASE ${identifier(receipt.database)}`);
    },
    true,
  );
  receipt.status = "REMOVED";
  await writeSigned(path, receipt, config);
  return {
    status: result?.absent ? "RESTORE_ALREADY_ABSENT" : "RESTORE_REMOVED",
    database: receipt.database,
  };
}
export async function listBackups(config = undefined) {
  config ??= await loadDailyConfig();
  let directories;
  try {
    directories = await readdir(backupRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of directories) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    try {
      const manifest = validateManifest(
        await readSigned(join(backupRoot, entry.name, "manifest.json"), config),
        config,
      );
      result.push({
        id: manifest.id,
        directory: join(backupRoot, entry.name),
        createdAt: manifest.createdAt,
        bytes: manifest.archive.bytes,
        status: "SIGNED_MANIFEST_ONLY",
      });
    } catch {
      result.push({
        id: entry.name,
        directory: join(backupRoot, entry.name),
        status: "INCOMPLETE_OR_UNTRUSTED",
      });
    }
  }
  return result.sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );
}
