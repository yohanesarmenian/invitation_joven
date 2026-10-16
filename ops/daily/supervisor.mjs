import { createServer } from "node:http";
import { fork } from "node:child_process";
import { readFile, writeFile, unlink, mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  root,
  dailyDirectory,
  dailyEnvironment,
  redactDailyOutput,
} from "./config.mjs";
import {
  assertPortsAvailable,
  assertDatabase,
  assertMigrations,
  stopDatabase,
  ownedContainer,
  compose,
} from "./database.mjs";

const statePath = resolve(dailyDirectory, "runtime.json");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
export async function deadline(promise, ms, reason) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(reason)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function readState(config) {
  let text;
  try {
    text = await readFile(statePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw Error("Daily runtime ownership cannot be read.");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error(
      "Daily runtime ownership is malformed; it was retained for recovery.",
    );
  }
  if (
    value.profileId !== config.profileId ||
    value.database !== config.database ||
    value.fingerprint !== config.fingerprint ||
    typeof value.instance !== "string" ||
    !/^[\w-]{43}$/.test(value.token ?? "")
  )
    throw Error(
      "Daily runtime ownership does not match this configuration; it was retained.",
    );
  return value;
}
async function control(config, state, action) {
  const response = await fetch(
    `http://127.0.0.1:${config.DAILY_CONTROL_PORT}/${action}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.token}`,
        "X-Daily-Instance": state.instance,
      },
      signal: AbortSignal.timeout(action === "stop" ? 30_000 : 5000),
    },
  );
  if (!response.ok)
    throw Error("Daily control authentication or state failed.");
  const value = await response.json();
  if (value.instance !== state.instance)
    throw Error("Daily control identity mismatch.");
  return value;
}
async function health(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
export async function dailyStatus(config) {
  const state = await readState(config);
  if (!state) {
    const container = await ownedContainer(config);
    return {
      status: container?.running ? "database-only" : "stopped",
      publicOrigin: config.publicOrigin,
      adminOrigin: config.adminOrigin,
    };
  }
  try {
    return await control(config, state, "status");
  } catch {
    return {
      status: "unknown",
      reason:
        "Runtime ownership exists but its authenticated owner is unavailable. No PID-based cleanup was attempted.",
    };
  }
}
export async function stopDaily(config) {
  const state = await readState(config);
  if (state) {
    try {
      return await control(config, state, "stop");
    } catch {
      throw Error(
        "Daily owner unavailable. Runtime identity retained; no process was killed by PID or port.",
      );
    }
  }
  await stopDatabase(config);
  return { status: "stopped", volumePreserved: true };
}
export async function recoverDaily(config) {
  const state = await readState(config);
  if (!state) return { status: "no-runtime-state" };
  try {
    await control(config, state, "status");
    throw Error("Daily owner is still reachable. Use local:down.");
  } catch (error) {
    if (error.message === "Daily owner is still reachable. Use local:down.")
      throw error;
  }
  await assertPortsAvailable([
    config.DAILY_PUBLIC_PORT,
    config.DAILY_ADMIN_PORT,
    config.DAILY_API_PORT,
  ]);
  const reservation = createServer();
  await new Promise((done, reject) => {
    reservation.once("error", () =>
      reject(Error("Daily control port is occupied; recovery refused.")),
    );
    reservation.listen(config.DAILY_CONTROL_PORT, "127.0.0.1", done);
  });
  try {
    await assertDatabase(config);
    const current = await readState(config);
    if (current?.instance !== state.instance || current.token !== state.token)
      throw Error("Daily runtime identity changed during recovery.");
    const retained = resolve(
      dailyDirectory,
      `recovered-${state.instance}.json`,
    );
    await rename(statePath, retained);
    return {
      status: "recovered",
      resourcesKilled: 0,
      previousIdentityRetained: true,
    };
  } finally {
    await new Promise((done) => reservation.close(done));
  }
}
export async function runDaily(config) {
  const state = await readState(config);
  if (state)
    throw Error(
      "Daily runtime ownership already exists. Use local:status/local:down; do not start a second supervisor.",
    );
  await assertPortsAvailable([
    config.DAILY_PUBLIC_PORT,
    config.DAILY_ADMIN_PORT,
    config.DAILY_API_PORT,
    config.DAILY_CONTROL_PORT,
  ]);
  const db = await ownedContainer(config);
  let databaseStarted = false;
  if (!db?.running) {
    if (!db)
      throw Error("Daily database has not been initialized. Run local:init.");
    await assertPortsAvailable([config.DAILY_PG_PORT]);
    await compose(config, [
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "90",
      "postgres",
    ]);
    databaseStarted = true;
  }
  try {
    await assertDatabase(config);
    await assertMigrations(config);
  } catch (error) {
    if (databaseStarted) await stopDatabase(config);
    throw error;
  }
  await mkdir(dailyDirectory, { recursive: true });
  const identity = {
    instance: randomUUID(),
    token: randomBytes(32).toString("base64url"),
    profileId: config.profileId,
    fingerprint: config.fingerprint,
    database: config.database,
  };
  const encoded = JSON.stringify(identity);
  await writeFile(statePath, encoded, { flag: "wx", mode: 0o600 });
  const workers = [],
    env = dailyEnvironment(config);
  let phase = "starting",
    shuttingDown;
  const snapshot = async () => ({
    instance: identity.instance,
    database: config.database,
    status: ["ready", "degraded"].includes(phase)
      ? workers.length === 3 &&
        workers.every(
          (item) =>
            item.child.exitCode === null && item.child.signalCode === null,
        ) &&
        (
          await Promise.all([
            health(`${config.apiOrigin}/health`),
            health(`${config.publicOrigin}/`),
            health(`${config.adminOrigin}/login`),
          ])
        ).every(Boolean)
        ? "ready"
        : "degraded"
      : phase,
    publicOrigin: config.publicOrigin,
    adminOrigin: config.adminOrigin,
    workers: workers.map((item) => ({
      app: item.app,
      running: item.child.exitCode === null && item.child.signalCode === null,
      ...(item.app === "api" ? { generation: item.generation ?? 0 } : {}),
    })),
  });
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? ""),
      expected = Buffer.from(`Bearer ${identity.token}`);
    if (
      req.method !== "POST" ||
      req.headers["x-daily-instance"] !== identity.instance ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (req.url === "/status") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(await snapshot()));
      } else if (req.url === "/stop") {
        await shutdown(true);
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            instance: identity.instance,
            status: "stopped",
            volumePreserved: true,
          }),
        );
        server.close();
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch {
      res.writeHead(503);
      res.end();
      if (req.url === "/stop") server.close();
    }
  });
  const waitExit = (item) => item.closed;
  async function shutdown(stopDb = false) {
    if (shuttingDown) return shuttingDown;
    phase = "stopping";
    shuttingDown = (async () => {
      let incomplete = false;
      for (const item of [...workers].reverse()) {
        try {
          const exited = waitExit(item);
          if (item.child.connected) item.child.send({ type: "stop" });
          try {
            await deadline(exited, 10_000, "Worker stop timeout");
          } catch {
            item.child.kill("SIGKILL");
            await deadline(
              exited,
              5000,
              "Daily worker cleanup failed; ownership retained.",
            );
          }
          if (!item.stopped) incomplete = true;
        } catch {
          incomplete = true;
        }
      }
      if (incomplete)
        throw Error(
          "Daily worker cleanup was not acknowledged. Runtime ownership retained for recovery.",
        );
      if (stopDb || databaseStarted) await stopDatabase(config);
      if ((await readFile(statePath, "utf8").catch(() => null)) === encoded)
        await unlink(statePath);
      phase = "stopped";
    })();
    return shuttingDown;
  }
  const stopSignal = () => {
    void shutdown(true)
      .then(() => server.close())
      .catch(() => {
        console.error("Daily shutdown incomplete; ownership retained.");
        server.closeAllConnections();
        server.close();
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", stopSignal);
  process.once("SIGTERM", stopSignal);
  try {
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(config.DAILY_CONTROL_PORT, "127.0.0.1", done);
    });
    for (const [app, port, url] of [
      ["api", config.DAILY_API_PORT, `${config.apiOrigin}/health`],
      ["invitation-web", config.DAILY_PUBLIC_PORT, `${config.publicOrigin}/`],
      ["admin-web", config.DAILY_ADMIN_PORT, `${config.adminOrigin}/login`],
    ]) {
      const child = fork(resolve(root, "ops/daily/worker.mjs"), [], {
          env,
          windowsHide: true,
          detached: process.platform === "win32",
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        }),
        item = {
          app,
          child,
          closed: new Promise((done) => child.once("close", done)),
        };
      workers.push(item);
      // Bound each log line; redact only the configured sensitive values, not ambient env.
      for (const stream of [child.stdout, child.stderr]) {
        let pending = "";
        stream.on("data", (data) => {
          pending += data.toString();
          let boundary;
          while ((boundary = pending.indexOf("\n")) !== -1) {
            const line = pending.slice(0, boundary);
            pending = pending.slice(boundary + 1);
            console.log(
              `[${app}] ${redactDailyOutput(line.slice(0, 8192), config)}`,
            );
          }
          if (pending.length > 8192)
            pending = "[oversized daily worker log omitted]";
        });
      }
      const started = new Promise((done, reject) => {
        child.on("message", (message) => {
          if (message.type === "api-generation")
            item.generation = message.value;
          if (message.type === "stopped") item.stopped = true;
          if (message.type === "started") done();
          if (message.type === "failed") {
            console.error(
              `[${app}] ${redactDailyOutput(message.reason ?? "Worker failure", config)}`,
            );
            phase = "degraded";
            reject(Error("Daily worker failed to start."));
          }
        });
        child.once("exit", () => {
          if (phase !== "stopping" && phase !== "stopped") phase = "degraded";
          reject(Error("Daily worker exited before readiness."));
        });
        child.once("error", () =>
          reject(Error("Daily worker could not start.")),
        );
      });
      child.send({ type: "start", root, app, port });
      await deadline(started, 90_000, "Daily worker startup timed out.");
      await deadline(
        (async () => {
          while (phase === "starting") {
            if (await health(url)) return;
            await pause(250);
          }
          throw Error("Daily startup stopped before readiness.");
        })(),
        45_000,
        "Daily health check timed out.",
      );
    }
    phase = "ready";
    console.log(
      JSON.stringify({
        status: "ready",
        publicOrigin: config.publicOrigin,
        adminOrigin: config.adminOrigin,
        database: config.database,
      }),
    );
    await new Promise((done) => server.once("close", done));
    if (phase !== "stopped")
      throw Error("Daily shutdown incomplete; ownership retained.");
  } catch (error) {
    try {
      await shutdown();
    } finally {
      server.closeAllConnections();
      server.close();
    }
    throw error;
  } finally {
    process.removeListener("SIGINT", stopSignal);
    process.removeListener("SIGTERM", stopSignal);
  }
}
