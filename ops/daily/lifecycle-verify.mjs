import { spawn } from "node:child_process";
import {
  readFile,
  mkdir,
  writeFile,
  unlink,
  rmdir,
  utimes,
} from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import net from "node:net";
import { poll } from "./poll.mjs";
import {
  root,
  configPath,
  rootRequire,
  loadDailyConfig,
  redactDailyOutput,
} from "./config.mjs";
import {
  initializeDatabase,
  assertPortsAvailable,
  stopDatabase,
  compose,
} from "./database.mjs";
import {
  dailyStatus,
  stopDaily,
  recoverDaily,
  deadline,
} from "./supervisor.mjs";

const assert = (value, message) => {
  if (!value) throw Error(message);
};
async function main() {
  const config = await loadDailyConfig(),
    before = await dailyStatus(config),
    started = Date.now();
  assert(
    ["stopped", "database-only"].includes(before.status),
    "Stop existing daily before lifecycle verification.",
  );
  await initializeDatabase(config);
  const fingerprint = createHash("sha256")
      .update(await readFile(configPath))
      .digest("hex"),
    checks = [];
  const record = (label) => {
    checks.push(label);
    console.log(`LIFECYCLE_VERIFIED ${label}`);
  };
  let owner,
    browser,
    blocker,
    cleanupFailed = false;
  const routes = [];
  const launch = () => {
    const child = spawn(
      process.execPath,
      [resolve(root, "ops/local-daily.mjs"), "up"],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        output = (output + redactDailyOutput(data.toString(), config)).slice(
          -16_384,
        );
      });
    const ended = new Promise((done) =>
      child.once("close", (code) => done(code)),
    );
    return { child, ended, output: () => output };
  };
  const ready = () =>
    poll(
      async () => {
        const status = await dailyStatus(config);
        if (status.status === "ready") return status;
        if (owner.child.exitCode !== null)
          throw Error("Daily owner exited during verification");
        return false;
      },
      120_000,
      "Daily owner readiness timeout",
    );
  try {
    owner = launch();
    const initial = await ready();
    record("real-daily-native-startup");
    const duplicate = launch();
    assert(
      (await deadline(
        duplicate.ended,
        10_000,
        "Duplicate startup did not refuse",
      )) !== 0,
      "Second daily owner must refuse",
    );
    record("duplicate-owner-refused");
    await stopDatabase(config);
    await poll(
      async () => {
        const state = await dailyStatus(config);
        if (
          state.status === "degraded" &&
          state.workers.every((item) => item.running)
        )
          return true;
        return false;
      },
      30_000,
      "Running API with unavailable PostgreSQL must report degraded",
    );
    await compose(config, [
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "90",
      "postgres",
    ]);
    await ready();
    record(
      "live-workers-report-degraded-on-database-outage-and-ready-after-recovery",
    );
    const api = resolve(root, "apps/api/src/runtime/listen-config.ts");
    await utimes(api, new Date(), new Date());
    await poll(
      async () => {
        const status = await dailyStatus(config);
        if (
          status.status === "ready" &&
          status.workers.find((item) => item.app === "api").generation >
            initial.workers.find((item) => item.app === "api").generation
        )
          return true;
        return false;
      },
      30_000,
      "API hot reload did not finish",
    );
    record("API-hot-reload-with-one-live-generation");
    browser = await rootRequire("@playwright/test").chromium.launch({
      headless: true,
      args: ["--disable-gpu", "--renderer-process-limit=2"],
    });
    for (const [app, origin] of [
      ["invitation-web", config.publicOrigin],
      ["admin-web", config.adminOrigin],
    ]) {
      const segment = `daily-hmr-${randomUUID().slice(0, 8)}`,
        directory = resolve(root, "apps", app, "app/dev", segment),
        file = resolve(directory, "page.tsx");
      await mkdir(directory, { recursive: true });
      routes.push({ directory, file });
      const page = await browser.newPage();
      page.setDefaultTimeout(30_000);
      page.setDefaultNavigationTimeout(30_000);
      await writeFile(
        file,
        "export default function Page(){return <p>daily-hot-reload-first</p>}\n",
        { flag: "wx" },
      );
      const routeUrl = `${origin}/dev/${segment}`;
      // Next's route discovery is asynchronous after creating a new directory.
      // Establish initial route availability before testing in-page HMR.
      await poll(
        async () => {
          try {
            const response = await fetch(routeUrl, {
              signal: AbortSignal.timeout(5000),
            });
            await response.body?.cancel();
            return response.ok;
          } catch {
            return false;
          }
        },
        30_000,
        "New HMR route was not discovered",
        250,
      );
      await page.goto(routeUrl);
      await page.getByText("daily-hot-reload-first", { exact: true }).waitFor();
      await writeFile(
        file,
        "export default function Page(){return <p>daily-hot-reload-second</p>}\n",
      );
      await page
        .getByText("daily-hot-reload-second", { exact: true })
        .waitFor({ timeout: 30_000 });
      await page.close();
      record(`${app}-browser-HMR-without-navigation`);
    }
    await browser.close();
    browser = undefined;
    await stopDaily(config);
    assert(
      (await deadline(owner.ended, 20_000, "Owner did not exit after stop")) ===
        0,
      "Graceful owner stop failed",
    );
    owner = undefined;
    await assertPortsAvailable([
      config.DAILY_PUBLIC_PORT,
      config.DAILY_ADMIN_PORT,
      config.DAILY_API_PORT,
      config.DAILY_CONTROL_PORT,
      config.DAILY_PG_PORT,
    ]);
    record("graceful-down-closes-all-daily-listeners-and-preserves-volume");
    owner = launch();
    await ready();
    owner.child.kill("SIGKILL");
    await owner.ended;
    owner = undefined;
    await poll(
      async () => {
        try {
          await assertPortsAvailable([
            config.DAILY_PUBLIC_PORT,
            config.DAILY_ADMIN_PORT,
            config.DAILY_API_PORT,
            config.DAILY_CONTROL_PORT,
          ]);
          return true;
        } catch {
          return false;
        }
      },
      30_000,
      "Workers did not release ports after owner loss",
    );
    assert(
      (await dailyStatus(config)).status === "unknown",
      "Lost-owner state must remain unknown until reconciled",
    );
    const recovered = await recoverDaily(config);
    assert(
      recovered.resourcesKilled === 0 && recovered.previousIdentityRetained,
      "Recovery must retain ownership history and kill no PID",
    );
    record(
      "forced-owner-loss-cleans-IPC-children-and-explicit-recovery-retains-history",
    );
    // Occupy the admin port after the owner's preflight to exercise a real
    // partial startup failure without adding a test bypass to production code.
    owner = launch();
    await poll(
      async () => (await dailyStatus(config)).status === "starting",
      10_000,
      "Could not reach partial-start phase",
      25,
    );
    blocker = net.createServer();
    await new Promise((done, reject) => {
      blocker.once("error", reject);
      blocker.listen(config.DAILY_ADMIN_PORT, "127.0.0.1", done);
    });
    assert(
      (await deadline(
        owner.ended,
        90_000,
        "Partial startup did not clean up",
      )) !== 0,
      "Partial startup must fail",
    );
    owner = undefined;
    assert(
      blocker.listening,
      "Partial failure must preserve the foreign listener",
    );
    await assertPortsAvailable([
      config.DAILY_PUBLIC_PORT,
      config.DAILY_API_PORT,
      config.DAILY_CONTROL_PORT,
    ]);
    await new Promise((done) => blocker.close(done));
    blocker = undefined;
    record("partial-startup-failure-cleans-only-owned-workers");
    assert(
      createHash("sha256")
        .update(await readFile(configPath))
        .digest("hex") === fingerprint,
      "Daily private configuration changed",
    );
  } catch (error) {
    await writeFile(
      resolve(root, ".local-daily/lifecycle-failure.json"),
      JSON.stringify(
        {
          after: checks.at(-1),
          reason: redactDailyOutput(error.message, config).slice(0, 2000),
          ownerOutputTail: owner?.output(),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (blocker) await new Promise((done) => blocker.close(done));
    if (owner) {
      await stopDaily(config).catch(() => {});
      if (owner.child.exitCode === null) owner.child.kill("SIGKILL");
      await owner.ended;
    }
    const cleanup = await Promise.allSettled(
      routes.map(async ({ file, directory }) => {
        await unlink(file);
        await rmdir(directory);
      }),
    );
    cleanupFailed = cleanup.some((result) => result.status === "rejected");
  }
  if (cleanupFailed)
    throw Error(
      "Owned HMR route cleanup incomplete; preserve paths for recovery.",
    );
  await writeFile(
    resolve(root, ".local-daily/lifecycle-verification.json"),
    JSON.stringify(
      {
        checks,
        elapsedMs: Date.now() - started,
        activeResourceTypes: process.getActiveResourcesInfo(),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "verified",
      checks: checks.length,
      elapsedMs: Date.now() - started,
    }),
  );
}
main().catch(() => {
  console.error(
    "Daily lifecycle verification failed; no foreign process cleanup was attempted.",
  );
  process.exitCode = 1;
});
