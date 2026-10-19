import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { once } from "node:events";

let close = async () => {},
  stopping = false;
process.on("message", async (message) => {
  if (message?.type === "stop") {
    await shutdown();
    return;
  }
  if (message?.type !== "start") return;
  try {
    const { app, root, port } = message;
    const directory = resolve(root, "apps", app),
      requireApp = createRequire(resolve(directory, "package.json"));
    process.chdir(directory);
    if (app === "api") {
      let generation = 0,
        child,
        timer,
        reloading = false,
        chain = Promise.resolve();
      const start = () => {
        process.send?.({ type: "api-generation", value: ++generation });
        child = spawn(
          process.execPath,
          [
            "--import",
            pathToFileURL(
              createRequire(resolve(root, "package.json")).resolve("tsx/esm"),
            ).href,
            resolve(root, "ops/daily/api-entry.mjs"),
          ],
          {
            cwd: directory,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            windowsHide: true,
          },
        );
        child.stdout.pipe(process.stdout);
        child.stderr.pipe(process.stderr);
        child.once("error", () =>
          process.send?.({
            type: "failed",
            reason: "API process could not start",
          }),
        );
        child.once("exit", () => {
          if (!stopping && !reloading)
            process.send?.({ type: "failed", reason: "API process exited" });
        });
      };
      const stopChild = async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
          const ended = once(child, "exit");
          child.kill("SIGTERM");
          let timer;
          try {
            await Promise.race([
              ended,
              new Promise((done) => {
                timer = setTimeout(done, 5000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            let forcedTimer;
            try {
              await Promise.race([
                ended,
                new Promise((_, reject) => {
                  forcedTimer = setTimeout(
                    () =>
                      reject(
                        Error(
                          "Owned API process did not exit; restart refused",
                        ),
                      ),
                    5000,
                  );
                }),
              ]);
            } finally {
              clearTimeout(forcedTimer);
            }
          }
        }
      };
      const watcher = watch(
        resolve(directory, "src"),
        { recursive: true },
        (_event, file) => {
          if (
            !file ||
            !/\.(?:ts|json)$/.test(file) ||
            String(file).includes("generated")
          )
            return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            chain = chain.then(async () => {
              reloading = true;
              try {
                await stopChild();
                if (!stopping) start();
              } finally {
                reloading = false;
              }
            });
          }, 400);
        },
      );
      close = async () => {
        clearTimeout(timer);
        watcher.close();
        await chain;
        await stopChild();
      };
      start();
    } else {
      const createNext = requireApp("next");
      const next = createNext({
        dev: true,
        // Next 16 custom-server option: Webpack keeps CSS compilation in the
        // owned worker. Turbopack's detached transform pool outlived owner loss
        // on Windows in the real lifecycle rehearsal.
        webpack: true,
        dir: directory,
        hostname: "127.0.0.1",
        port,
      });
      let server;
      close = async () => {
        if (server) {
          server.closeAllConnections();
          await new Promise((done) => server.close(done));
        }
        await next.close();
      };
      await next.prepare();
      if (stopping) {
        await close();
        return;
      }
      server = createServer(next.getRequestHandler());
      await new Promise((done, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", done);
      });
    }
    process.send?.({ type: "started" });
  } catch (error) {
    process.send?.({
      type: "failed",
      reason:
        error instanceof Error
          ? error.message.slice(0, 512)
          : "Daily worker startup failed",
    });
    await shutdown();
  }
});
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await close();
    if (process.connected)
      process.send({ type: "stopped" }, () => process.exit(0));
    else process.exit(0);
  } catch {
    if (process.connected)
      process.send({ type: "cleanup-failed" }, () => process.exit(1));
    else process.exit(1);
  }
}
process.once("disconnect", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
