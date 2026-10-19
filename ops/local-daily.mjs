import { resolve } from "node:path";
import { createInterface, emitKeypressEvents } from "node:readline";
import {
  root,
  apiRequire,
  rootRequire,
  initializeConfig,
  loadDailyConfig,
  dailyEnvironment,
} from "./daily/config.mjs";
import {
  initializeDatabase,
  assertConfigurationCreationAllowed,
  assertDatabase,
  assertMigrations,
  command,
} from "./daily/database.mjs";
import { initializeCatalog } from "./daily/catalog.mjs";
import {
  runDaily,
  dailyStatus,
  stopDaily,
  recoverDaily,
} from "./daily/supervisor.mjs";

async function ownerInput() {
  if (process.env.ADMIN_BOOTSTRAP_EMAIL && process.env.ADMIN_BOOTSTRAP_PASSWORD)
    return {
      email: process.env.ADMIN_BOOTSTRAP_EMAIL,
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    };
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error(
      "OWNER setup requires private ADMIN_BOOTSTRAP_EMAIL/PASSWORD environment values or an interactive terminal.",
    );
  const reader = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const email = await new Promise((done) =>
    reader.question("OWNER email: ", done),
  );
  reader.close();
  const hidden = async (prompt) => {
    process.stdout.write(prompt);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = "";
    return new Promise((done, reject) => {
      const keypress = (character, key) => {
        if (key?.ctrl && key.name === "c") {
          cleanup();
          reject(Error("OWNER setup cancelled."));
        } else if (key?.name === "return") {
          cleanup();
          done(value);
        } else if (key?.name === "backspace")
          value = Array.from(value).slice(0, -1).join("");
        else if (character && !key?.ctrl && !key?.meta) value += character;
      };
      const cleanup = () => {
        process.stdin.off("keypress", keypress);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write("\n");
      };
      process.stdin.on("keypress", keypress);
    });
  };
  const password = await hidden("OWNER password (hidden): ");
  if (password !== (await hidden("Repeat password (hidden): ")))
    throw Error("OWNER passwords did not match.");
  return { email, password };
}
async function main() {
  const [action, ...raw] = process.argv.slice(2),
    args = raw.filter((item) => item !== "--");
  if (action === "init") {
    await assertConfigurationCreationAllowed();
    const config = await initializeConfig();
    const migrations = await initializeDatabase(config);
    const cli = resolve(
      apiRequire.resolve("prisma/package.json"),
      "../build/index.js",
    );
    await command(process.execPath, [cli, "generate"], {
      cwd: resolve(root, "apps/api"),
      env: dailyEnvironment(config),
    });
    console.log(
      JSON.stringify({
        status: "initialized",
        database: config.database,
        migrations,
        secretPreserved: true,
        next: "local:owner, local:catalog <file>, local:up",
      }),
    );
    return;
  }
  const config = await loadDailyConfig();
  if (action === "up") return runDaily(config);
  if (action === "status") {
    console.log(JSON.stringify(await dailyStatus(config)));
    return;
  }
  if (action === "down") {
    console.log(JSON.stringify(await stopDaily(config)));
    return;
  }
  if (action === "recover") {
    console.log(JSON.stringify(await recoverDaily(config)));
    return;
  }
  if (action === "catalog") {
    if (args.length !== 1)
      throw Error(
        "Choose one catalog JSON explicitly. Example: local:catalog ops/daily/catalog.example.json",
      );
    await assertMigrations(config);
    console.log(
      JSON.stringify(
        await initializeCatalog(config, resolve(process.cwd(), args[0])),
      ),
    );
    return;
  }
  if (action === "owner") {
    await assertDatabase(config);
    await assertMigrations(config);
    const input = await ownerInput(),
      env = dailyEnvironment(config);
    env.ADMIN_BOOTSTRAP_EMAIL = input.email;
    env.ADMIN_BOOTSTRAP_PASSWORD = input.password;
    const result = await command(
      process.execPath,
      [rootRequire.resolve("tsx/cli"), "scripts/admin-bootstrap-owner.ts"],
      { cwd: resolve(root, "apps/api"), env },
    );
    console.log(result.trim());
    return;
  }
  if (action === "generate") {
    await assertDatabase(config);
    const cli = resolve(
      apiRequire.resolve("prisma/package.json"),
      "../build/index.js",
    );
    await command(process.execPath, [cli, "generate"], {
      cwd: resolve(root, "apps/api"),
      env: dailyEnvironment(config),
    });
    console.log("Daily Prisma client generated.");
    return;
  }
  if (
    [
      "backup",
      "backup-verify",
      "backup-list",
      "restore",
      "restore-remove",
    ].includes(action)
  ) {
    const {
      createBackup,
      verifyBackup,
      listBackups,
      restoreBackup,
      removeRestore,
    } = await import("./daily/backup.mjs");
    if (
      ["backup", "backup-list"].includes(action)
        ? args.length !== 0
        : args.length !== 1
    )
      throw Error(
        "Choose exactly one backup/receipt directory when verifying/restoring/removing; backup and backup-list take no arguments.",
      );
    let result;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      if (action === "backup")
        result = await createBackup(config, { signal: abort.signal });
      if (action === "backup-list") result = await listBackups(config);
      if (action === "backup-verify") {
        const { manifest } = await verifyBackup(resolve(args[0]), config);
        result = {
          status: "BACKUP_INTEGRITY_VERIFIED",
          id: manifest.id,
          bytes: manifest.archive.bytes,
        };
      }
      if (action === "restore")
        result = await restoreBackup(resolve(args[0]), config, {
          signal: abort.signal,
        });
      if (action === "restore-remove")
        result = await removeRestore(resolve(args[0]), config);
      console.log(JSON.stringify(result));
    } catch (error) {
      throw Error(
        error.message?.startsWith("Daily ")
          ? error.message
          : "Daily backup operation failed; private diagnostics omitted. No automatic retry.",
      );
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
    return;
  }
  throw Error(
    "Choose init, up, status, down, recover, owner, catalog, generate, backup, backup-list, backup-verify, restore or restore-remove.",
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Daily workflow failed.",
  );
  process.exitCode = 1;
});
