import {
  mkdir,
  writeFile,
  readFile,
  unlink,
  rm,
  chmod,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { root, dailyDirectory, rootRequire } from "./config.mjs";
import { command, withClient, assertDatabase } from "./database.mjs";
import { pgTransport } from "./pg-transport.mjs";
import { protectPrivatePath } from "./private-files.mjs";
import { deadline } from "./supervisor.mjs";

const assert = (value, message) => {
  if (!value) throw Error(message);
};
function cleanupMetadata(directory) {
  const id = relative(dailyDirectory, directory);
  assert(
    !isAbsolute(id) && /^gap-backup-[a-f0-9-]{36}$/.test(id),
    "Unresolved backup directory ownership",
  );
  return resolve(dailyDirectory, `backup-cleanup-${id}.json`);
}
async function readCleanupIdentity(directory) {
  try {
    const state = JSON.parse(
      await readFile(cleanupMetadata(directory), "utf8"),
    );
    assert(
      state.directory === directory && state.status === "CLEANUP_PENDING",
      "Cleanup metadata belongs to a different or unresolved resource",
    );
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function retainCleanupIdentity(directory, code) {
  if (await readCleanupIdentity(directory)) return;
  await writeFile(
    cleanupMetadata(directory),
    JSON.stringify({
      directory,
      status: "CLEANUP_PENDING",
      code: typeof code === "string" ? code : "UNKNOWN",
      reason:
        "Owned backup directory cleanup incomplete; explicit reconciliation required",
    }),
    { flag: "wx" },
  );
}
async function removeOwnedBackupDirectory(directory) {
  cleanupMetadata(directory); // validate exact private UUID scope before rm
  await readCleanupIdentity(directory);
  try {
    await rm(directory, { recursive: true });
  } catch (error) {
    await retainCleanupIdentity(directory, error.code);
    return false;
  }
  if (await readCleanupIdentity(directory))
    await unlink(cleanupMetadata(directory));
  return true;
}
async function sourceHash(qa) {
  const tables = [
    "admin_users",
    "events",
    "invitations",
    "invitees",
    "invitation_events",
    "rsvps",
    "rsvp_attendees",
    "rsvp_event_selections",
    "guest_messages",
    "checkin_passes",
    "checkin_records",
    "event_contents",
    "event_content_assets",
  ];
  return withClient(qa.databaseUrl, async (client) => {
    const fingerprints = [];
    for (const table of tables) {
      const rows = (
        await client.query(
          `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
      fingerprints.push([
        table,
        rows.length,
        createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
      ]);
    }
    return JSON.stringify(fingerprints);
  });
}
async function denyDirectoryWrites(directory) {
  if (process.platform !== "win32") {
    await chmod(directory, 0o500);
    return;
  }
  const script = `$ErrorActionPreference='Stop'
$target=$env:INVITATION_QA_DENIED_DIRECTORY
$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$allow=[System.Security.AccessControl.AccessControlType]::Allow
$propagate=[System.Security.AccessControl.PropagationFlags]::None
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($owner,[System.Security.AccessControl.FileSystemRights]::ReadAndExecute,$inherit,$propagate,$allow)))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,$propagate,$allow)))
[System.IO.Directory]::SetAccessControl($target,$acl)`;
  await command(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { env: { ...process.env, INVITATION_QA_DENIED_DIRECTORY: directory } },
  );
}
export async function runBackupFailures({ qa, env, record }) {
  assert(
    /^invitation_qa_daily_[a-f0-9]{16}$/.test(qa.database),
    "Backup faults require exact disposable QA identity",
  );
  await assertDatabase(qa);
  const before = await sourceHash(qa);
  const restoreNames = () =>
    withClient(
      qa.operatorUrl,
      async (client) =>
        (
          await client.query(
            "SELECT datname FROM pg_database WHERE datname LIKE 'invitation_restore_%' ORDER BY datname",
          )
        ).rows,
    );
  const restoresBefore = JSON.stringify(await restoreNames());
  const directory = resolve(dailyDirectory, `gap-backup-${randomUUID()}`);
  const within = relative(dailyDirectory, directory);
  assert(
    !isAbsolute(within) &&
      !within.startsWith("..") &&
      /^gap-backup-[a-f0-9-]{36}$/.test(within),
    "Backup fault directory ownership is unresolved",
  );
  await mkdir(directory);
  const originalPassword = process.env.PGPASSWORD;
  let denied = false,
    cleanupFailed = false;
  try {
    const operatorUrl = new URL(qa.operatorUrl);
    operatorUrl.pathname = `/${qa.database}`;
    const result = await command(
      process.execPath,
      [rootRequire.resolve("tsx/cli"), "scripts/local-backup-rehearsal.ts"],
      {
        cwd: resolve(root, "apps/api"),
        env: {
          ...env,
          DATABASE_URL: operatorUrl.toString(),
          PG_DUMP_NODE_WRAPPER: resolve(
            directory,
            "deliberately-missing-tool.mjs",
          ),
          PG_RESTORE_NODE_WRAPPER: resolve(root, "ops/daily/pg-restore.mjs"),
        },
        expectedFailure: "pg_dump failed; diagnostic contents omitted",
        timeout: 90_000,
      },
    );
    assert(
      !result.includes("RESTORE_VERIFIED") &&
        JSON.stringify(await restoreNames()) === restoresBefore &&
        (await sourceHash(qa)) === before,
      "Missing backup tool must fail, clean exact restore fixture and preserve source data",
    );
    record(
      "D62-real-missing-backup-tool-refuses-success-cleans-restore-and-preserves-source-state",
    );
    await denyDirectoryWrites(directory);
    denied = true;
    const probe = resolve(directory, "write-probe.txt");
    let probeDenied = false;
    try {
      await writeFile(probe, "synthetic-probe", { flag: "wx" });
      await unlink(probe);
    } catch (error) {
      probeDenied = ["EACCES", "EPERM"].includes(error.code);
    }
    assert(probeDenied, "OS permission denial was not actually established");
    process.env.PGPASSWORD = qa.operatorPassword;
    let permissionRefused = false;
    try {
      await pgTransport("pg_dump", [
        "--host",
        "127.0.0.1",
        "--port",
        String(qa.DAILY_PG_PORT),
        "--username",
        qa.operator,
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--file",
        resolve(directory, "permission-denied.dump"),
        qa.database,
      ]);
    } catch (error) {
      permissionRefused = ["EACCES", "EPERM"].includes(error.code);
    }
    assert(
      permissionRefused && (await sourceHash(qa)) === before,
      "Permission-denied backup must fail without changing source rows",
    );
    record(
      "D62-real-OS-write-permission-denial-fails-backup-and-preserves-source-state",
    );
  } finally {
    if (originalPassword === undefined) delete process.env.PGPASSWORD;
    else process.env.PGPASSWORD = originalPassword;
    try {
      if (denied) await protectPrivatePath(directory, true);
      // Both normal cleanup and the held-file fault use this same owner.
      cleanupFailed = !(await removeOwnedBackupDirectory(directory));
    } catch (error) {
      await retainCleanupIdentity(directory, error.code);
      cleanupFailed = true;
    }
  }
  assert(
    !cleanupFailed,
    "Backup fault cleanup incomplete; exact directory identity retained privately",
  );
  if (process.platform === "win32") await lockedFileCleanupRehearsal(record);
}

async function lockedFileCleanupRehearsal(record) {
  const id = `gap-backup-${randomUUID()}`,
    directory = resolve(dailyDirectory, id);
  assert(
    relative(dailyDirectory, directory) === id,
    "Cleanup fault target escaped its private parent",
  );
  await mkdir(directory); // fresh UUID, exclusive ownership in this invocation
  const file = resolve(directory, "synthetic-held-file.txt"),
    metadata = resolve(dailyDirectory, `backup-cleanup-${id}.json`);
  await writeFile(file, "synthetic cleanup fault", { flag: "wx" });
  const script = `$ErrorActionPreference='Stop'
$stream=[System.IO.File]::Open($env:INVITATION_QA_HELD_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
try{[Console]::WriteLine('FILE_HELD');[Console]::Out.Flush();[Console]::ReadLine()|Out-Null}finally{$stream.Dispose()}`;
  const holder = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      windowsHide: true,
      env: { ...process.env, INVITATION_QA_HELD_FILE: file },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = new Promise((done) => holder.once("close", done));
  holder.stderr.resume();
  const ready = new Promise((done, reject) => {
    let text = "";
    holder.stdout.on("data", (data) => {
      text += data.toString();
      if (text.includes("FILE_HELD")) done();
    });
    holder.once("error", () =>
      reject(Error("Owned file holder could not start")),
    );
    holder.once("exit", () =>
      reject(Error("Owned file holder exited before readiness")),
    );
  });
  let recorded = false;
  try {
    await deadline(ready, 10_000, "Owned file holder readiness timeout");
    const refused = !(await removeOwnedBackupDirectory(directory));
    assert(
      refused,
      "Windows delete-sharing failure was not actually established",
    );
    recorded = true;
    assert(
      JSON.parse(await readFile(metadata, "utf8")).directory === directory,
      "Failed cleanup did not retain the exact owned directory identity",
    );
  } finally {
    holder.stdin.end();
    try {
      await deadline(closed, 5000, "Owned file holder did not release");
    } catch {
      holder.kill("SIGKILL");
      await deadline(closed, 5000, "Owned file holder cleanup unresolved");
    }
  }
  // Explicit reconciliation after the owned handle releases the file.
  assert(
    await removeOwnedBackupDirectory(directory),
    "Explicit owned-directory recovery failed",
  );
  assert(recorded, "Cleanup pending state was not observed");
  record(
    "D62-real-Windows-held-file-cleanup-failure-retains-identity-and-explicit-recovery-removes-only-owned-directory",
  );
}
