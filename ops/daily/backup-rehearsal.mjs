import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  readFile,
  writeFile,
  readdir,
  rm,
  lstat,
  realpath,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { root, rootRequire, apiRequire } from "./config.mjs";
import { pgClient, withClient, command } from "./database.mjs";
import {
  createBackup,
  verifyBackup,
  restoreBackup,
  removeRestore,
} from "./backup.mjs";
import {
  backupRoot,
  restoreRoot,
  readSigned,
  writeSigned,
  sha256,
  UUID,
  fileDigest,
} from "./backup-storage.mjs";
import { snapshotTables } from "./backup-snapshot.mjs";
import { poll } from "./poll.mjs";
import { runBackupFailures } from "./backup-failure-rehearsal.mjs";
const assert = (value, message) => {
  if (!value) throw Error(`Daily ${message}`);
};
const nativeImport = (file) =>
  import(pathToFileURL(resolve(root, "apps/api/dist", file)).href);
async function hashDatabase(config) {
  return withClient(config.databaseUrl, async (db) => {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      return sha256(JSON.stringify(await snapshotTables(db)));
    } finally {
      await db.query("ROLLBACK");
    }
  });
}
async function directories(parent) {
  try {
    return (await readdir(parent)).filter((id) => UUID.test(id));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
async function restoredApi(qa, restored, fixture, guest) {
  const previous = process.env.DATABASE_URL,
    url = new URL(qa.databaseUrl);
  url.pathname = `/${restored.database}`;
  process.env.DATABASE_URL = url.toString();
  let app;
  try {
    apiRequire("reflect-metadata");
    const { NestFactory } = apiRequire("@nestjs/core"),
      { FastifyAdapter } = apiRequire("@nestjs/platform-fastify");
    const { AppModule } = await nativeImport("app.module.js"),
      { configureApp } = await nativeImport("app.setup.js");
    app = await NestFactory.create(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const rsvp = await app.inject({
      method: "GET",
      url: `/api/public/invitations/${guest.publicCredential}/rsvp`,
    });
    assert(
      rsvp.statusCode === 200 &&
        rsvp.json().checkinPass?.qrPayload === guest.qrPayload,
      "Restored guest credential/QR mismatch",
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      headers: { origin: qa.adminOrigin },
      payload: { email: fixture.staff.email, password: fixture.password },
    });
    assert(login.statusCode === 200, "Restored staff login failed");
    const cookie = String(login.headers["set-cookie"]).split(";")[0],
      headers = {
        cookie,
        origin: qa.adminOrigin,
        "x-csrf-token": login.json().csrfToken,
      };
    const validate = await app.inject({
      method: "POST",
      url: "/api/admin/checkin/validate",
      headers,
      payload: { qrPayload: guest.qrPayload, eventId: fixture.event.id },
    });
    assert(
      validate.statusCode === 200 && validate.json().alreadyCheckedIn === false,
      "Restored QR did not validate",
    );
    const payload = {
      qrPayload: guest.qrPayload,
      eventId: fixture.event.id,
      attendeeCount: 1,
    };
    const confirmed = await app.inject({
      method: "POST",
      url: "/api/admin/checkin/confirm",
      headers,
      payload,
    });
    assert(confirmed.statusCode === 201, "Restored QR could not confirm");
    assert(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/checkin/confirm",
          headers,
          payload,
        })
      ).statusCode === 409,
      "Restored duplicate confirmation not rejected",
    );
    const confirmedRows = await withClient(
      url.toString(),
      async (db) =>
        (
          await db.query(
            "SELECT attendee_count,confirmed_by_admin_user_id FROM checkin_records WHERE invitation_id=$1 AND event_id=$2",
            [guest.id, fixture.event.id],
          )
        ).rows,
    );
    assert(
      confirmedRows.length === 1 &&
        confirmedRows[0].attendee_count === 1 &&
        confirmedRows[0].confirmed_by_admin_user_id === fixture.staff.id,
      "Restored check-in persistence/operator mismatch",
    );
  } finally {
    await app?.close();
    process.env.DATABASE_URL = previous;
  }
}
export async function runBackupRehearsal({ qa, env, record }) {
  assert(
    /^invitation_qa_daily_[a-f0-9]{16}$/.test(qa.database),
    "Backup rehearsal refuses non-QA input",
  );
  const fixtureModule = await import(
    pathToFileURL(resolve(root, "apps/api/scripts/admin-workflow-fixture.ts"))
      .href
  );
  const fixture = await fixtureModule.createWorkflowFixture();
  const restores = [],
    sourceConfigBefore = await readFile(resolve(root, ".env.daily"));
  let blocker, child, pendingBackup;
  try {
    const bundlesBefore = JSON.stringify(await directories(backupRoot));
    await assertReject(() => createBackup({ ...qa, secret: "A".repeat(43) }));
    const foreign = new URL(qa.databaseUrl);
    foreign.port = "5433";
    await assertReject(() =>
      createBackup({ ...qa, databaseUrl: foreign.toString() }),
    );
    assert(
      JSON.stringify(await directories(backupRoot)) === bundlesBefore,
      "Identity mismatch must fail before writing backup files",
    );
    record("backup-source-identity-mismatch-refused-before-file-or-SQL-work");
    const guest = await fixture.household("Synthetic backup QR household");
    const arrived = await fixture.household(
      "Synthetic backup arrived household",
    );
    await fixture.prisma.checkinRecord.create({
      data: {
        invitationId: arrived.id,
        eventId: fixture.event.id,
        confirmedByAdminUserId: fixture.staff.id,
        method: "MANUAL",
        attendeeCount: 1,
      },
    });
    await fixture.prisma.guestMessage.create({
      data: {
        invitationId: guest.id,
        authorName: "Synthetic guest",
        message: "Synthetic backup message",
      },
    });
    const media = Buffer.from("synthetic byte-for-byte material");
    const asset = await fixture.prisma.eventContentAsset.create({
      data: {
        eventId: fixture.event.id,
        kind: "PDF",
        mimeType: "application/pdf",
        byteSize: media.length,
        bytes: new Uint8Array(media),
      },
    });
    const content = {
      parking: {
        title: "Synthetic parking",
        instructions: ["Synthetic instruction"],
        mapAssetId: null,
        mapAlt: "",
        pdfAssetId: asset.id,
        googleMapsUrl: null,
      },
      rundown: null,
    };
    await fixture.prisma.eventContent.create({
      data: {
        eventId: fixture.event.id,
        version: 3,
        draft: { ...content, rundown: { title: "Synthetic draft", items: [] } },
        published: content,
        publishedAt: new Date(),
      },
    });
    const before = await hashDatabase(qa),
      backup = await createBackup(qa);
    const checked = await verifyBackup(backup.directory, qa);
    assert(
      checked.manifest.tables.some(
        (t) => t.name === "event_content_assets" && t.rows > 0,
      ),
      "Backup must include material bytes",
    );
    record("backup-signed-manifest-config-and-all-table-snapshot");
    const restored = await restoreBackup(backup.directory, qa);
    restores.push(restored);
    const target = new URL(qa.databaseUrl);
    target.pathname = `/${restored.database}`;
    assert(
      (await hashDatabase({ ...qa, databaseUrl: target.toString() })) ===
        before,
      "All restored row fingerprints must match source",
    );
    await restoredApi(qa, restored, fixture, guest);
    assert(
      (await hashDatabase(qa)) === before,
      "Restore/QR rehearsal changed source QA",
    );
    record(
      "backup-full-restore-RSVP-material-bytes-staff-login-QR-confirm-duplicate-and-source-unchanged",
    );
    const active = pgClient(target.toString());
    await active.connect();
    try {
      await assertReject(() => removeRestore(restored.receipt, qa));
    } finally {
      await active.end();
    }
    const receiptFile = join(restored.receipt, "receipt.json"),
      receiptBytes = await readFile(receiptFile);
    const receipt = await readSigned(receiptFile, qa);
    await writeSigned(
      receiptFile,
      { ...receipt, database: "invitation_daily" },
      qa,
    );
    await assertReject(() => removeRestore(restored.receipt, qa));
    await writeFile(receiptFile, receiptBytes);
    assert(
      (await removeRestore(restored.receipt, qa)).status === "RESTORE_REMOVED",
      "Owned restore cleanup failed",
    );
    assert(
      (await removeRestore(restored.receipt, qa)).status ===
        "RESTORE_ALREADY_ABSENT",
      "Explicit absent-target reconciliation failed",
    );
    record("backup-cleanup-refuses-active-clients-and-daily-target-tampering");
    const dump = join(backup.directory, "database.dump"),
      manifestFile = join(backup.directory, "manifest.json"),
      bytes = await readFile(dump),
      signed = await readFile(manifestFile);
    const targetCount = async () =>
      withClient(
        qa.operatorUrl,
        async (db) =>
          (
            await db.query(
              "SELECT count(*)::int AS count FROM pg_database WHERE datname LIKE 'invitation_restore_daily_%'",
            )
          ).rows[0].count,
      );
    const count = await targetCount();
    await writeFile(dump, Buffer.concat([bytes, Buffer.from("corrupted")]));
    await assertReject(() => restoreBackup(backup.directory, qa));
    assert(
      (await targetCount()) === count,
      "Corrupt archive must refuse before allocation",
    );
    await writeFile(dump, bytes);
    await assertReject(() =>
      verifyBackup(backup.directory, { ...qa, secret: "A".repeat(43) }),
    );
    await writeSigned(
      manifestFile,
      {
        ...checked.manifest,
        migrations: [{ name: "incompatible", sha256: "0".repeat(64) }],
      },
      qa,
    );
    await assertReject(() => restoreBackup(backup.directory, qa));
    assert(
      (await targetCount()) === count,
      "Migration mismatch must refuse before allocation",
    );
    await writeFile(manifestFile, signed);
    record(
      "backup-corrupt-file-wrong-secret-and-migration-mismatch-refused-before-restore",
    );
    // An authentic but invalid archive reaches the real pg_restore boundary.
    await writeFile(dump, Buffer.from("PGDMP invalid archive"));
    await writeSigned(
      manifestFile,
      { ...checked.manifest, archive: await fileDigest(dump) },
      qa,
    );
    const oldReceipts = new Set(await directories(restoreRoot));
    await assertReject(() => restoreBackup(backup.directory, qa));
    const failedIds = (await directories(restoreRoot)).filter(
      (id) => !oldReceipts.has(id),
    );
    assert(failedIds.length === 1, "Failed restore identity missing");
    const failedDirectory = join(restoreRoot, failedIds[0]),
      failed = await readSigned(join(failedDirectory, "receipt.json"), qa);
    restores.push({ receipt: failedDirectory });
    assert(
      failed.status === "FAILED",
      "Failed restore must never claim verified",
    );
    await removeRestore(failedDirectory, qa);
    await writeFile(dump, bytes);
    await writeFile(manifestFile, signed);
    record(
      "backup-real-pg-restore-failure-retains-signed-failed-receipt-and-explicit-cleanup",
    );
    // Freeze one table AFTER export; a concurrent guest write must be excluded
    // from both the source fingerprint and the dump's exported MVCC snapshot.
    blocker = pgClient(qa.databaseUrl);
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK events IN ACCESS EXCLUSIVE MODE");
    const pid = Number(
      (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
    pendingBackup = createBackup(qa);
    pendingBackup.catch(() => {});
    await lockWait(qa, pid);
    await fixture.prisma.guestMessage.create({
      data: {
        invitationId: guest.id,
        authorName: "Synthetic late guest",
        message: "Written after backup snapshot",
      },
    });
    await blocker.query("COMMIT");
    await blocker.end();
    blocker = undefined;
    const concurrent = await pendingBackup,
      copy = await restoreBackup(concurrent.directory, qa);
    restores.push(copy);
    const copyUrl = new URL(qa.databaseUrl);
    copyUrl.pathname = `/${copy.database}`;
    assert(
      (await withClient(
        copyUrl.toString(),
        async (db) =>
          (
            await db.query(
              "SELECT count(*)::int AS count FROM guest_messages WHERE author_name=$1",
              ["Synthetic late guest"],
            )
          ).rows[0].count,
      )) === 0,
      "Dump and manifest must share the exported snapshot",
    );
    await removeRestore(copy.receipt, qa);
    record("backup-concurrent-write-snapshot-consistency");
    // Kill only the exact spawned QA backup handle while its snapshot is blocked.
    blocker = pgClient(qa.databaseUrl);
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK events IN ACCESS EXCLUSIVE MODE");
    const crashPid = Number(
        (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      ),
      originalBundles = new Set(await directories(backupRoot));
    child = spawn(
      process.execPath,
      [resolve(root, "ops/daily/backup-crash-child.mjs")],
      { cwd: root, env, windowsHide: true, stdio: "ignore" },
    );
    const stopped = once(child, "close");
    await lockWait(qa, crashPid);
    child.kill("SIGKILL");
    await stopped;
    child = undefined;
    await blocker.query("COMMIT");
    await blocker.end();
    blocker = undefined;
    const partial = (await directories(backupRoot)).filter(
      (id) => !originalBundles.has(id),
    );
    assert(partial.length === 1, "Interrupted backup ownership not retained");
    await assertReject(() => verifyBackup(join(backupRoot, partial[0]), qa));
    record(
      "backup-owned-process-interruption-never-publishes-complete-manifest",
    );
    // The prior QA-only wrapper remains fail closed and its real PG18 dump/
    // restore rehearsal still works after extracting shared stream ownership.
    const operator = new URL(qa.operatorUrl);
    operator.pathname = `/${qa.database}`;
    await command(
      process.execPath,
      [rootRequire.resolve("tsx/cli"), "scripts/local-backup-rehearsal.ts"],
      {
        cwd: resolve(root, "apps/api"),
        env: {
          ...env,
          DATABASE_URL: operator.toString(),
          PG_DUMP_NODE_WRAPPER: resolve(root, "ops/daily/pg-dump.mjs"),
          PG_RESTORE_NODE_WRAPPER: resolve(root, "ops/daily/pg-restore.mjs"),
        },
        timeout: 120000,
      },
    );
    record("backup-existing-QA-transport-real-regression");
    await runBackupFailures({ qa, env, record });
    assert(
      (await readFile(resolve(root, ".env.daily"))).equals(sourceConfigBefore),
      "Backup changed private configuration",
    );
  } finally {
    if (child) {
      const done = once(child, "close");
      child.kill("SIGKILL");
      await done;
    }
    if (blocker) {
      await blocker.query("ROLLBACK").catch(() => {});
      await blocker.end();
    }
    if (pendingBackup) await Promise.allSettled([pendingBackup]);
    await fixture.prisma.$disconnect();
    for (const restored of restores) await removeRestore(restored.receipt, qa);
    for (const id of await directories(backupRoot)) {
      const directory = join(await realpath(backupRoot), id);
      let operation;
      try {
        operation = await readSigned(join(directory, "operation.json"), qa);
      } catch {
        continue;
      }
      if (operation.database !== qa.database) continue;
      assert(
        operation.id === id &&
          operation.fingerprint === qa.fingerprint &&
          !(await lstat(directory)).isSymbolicLink() &&
          resolve(directory) === resolve(backupRoot, id),
        "QA backup removal identity mismatch",
      );
      await rm(directory, { recursive: true });
    }
  }
}
async function assertReject(action) {
  let rejected = false;
  try {
    await action();
  } catch {
    rejected = true;
  }
  assert(rejected, "Expected safe rejection did not occur");
}
async function lockWait(qa, pid) {
  await poll(
    async () =>
      withClient(
        qa.databaseUrl,
        async (db) =>
          (
            await db.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock') AS waiting",
              [pid],
            )
          ).rows[0].waiting,
      ),
    10000,
    "Daily expected real backup lock waiter",
  );
}
