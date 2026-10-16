import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { dockerBinary } from "./database.mjs";

// Policy belongs to callers. This owner streams one archive without buffering
// it, drains diagnostics privately and waits for its exact transport handle.
export async function streamArchive({
  container,
  binary,
  args,
  file,
  password,
  signal,
  timeoutMs = 300000,
}) {
  if (!["pg_dump", "pg_restore"].includes(binary))
    throw Error("Daily unsupported archive operation.");
  signal?.throwIfAborted();
  const handle = await open(file, binary === "pg_dump" ? "wx" : "r", 0o600);
  let child, timer;
  try {
    child = spawn(
      await dockerBinary(),
      [
        "exec",
        ...(binary === "pg_restore" ? ["--interactive"] : []),
        "--env",
        "PGPASSWORD",
        "--env",
        "PGOPTIONS",
        container,
        binary,
        ...args,
      ],
      {
        env: {
          ...process.env,
          PGPASSWORD: password,
          PGOPTIONS: "-c statement_timeout=120000 -c lock_timeout=10000",
        },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.stderr.resume();
    const exited = new Promise((done, reject) => {
      child.once("error", () =>
        reject(Error("Daily archive transport could not start.")),
      );
      child.once("close", (code) =>
        code === 0
          ? done()
          : reject(
              Error(
                "Daily archive transport failed; private diagnostics omitted.",
              ),
            ),
      );
    });
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, timeoutMs);
    if (signal?.aborted) abort();
    let io;
    if (binary === "pg_dump") {
      child.stdin.end();
      io = pipeline(child.stdout, handle.createWriteStream());
    } else {
      child.stdout.resume();
      io = pipeline(handle.createReadStream(), child.stdin);
    }
    io.catch(abort);
    const settled = await Promise.allSettled([io, exited]);
    signal?.removeEventListener("abort", abort);
    if (signal?.aborted || settled.some((r) => r.status !== "fulfilled"))
      throw Error(
        "Daily archive transfer incomplete. No successful backup/restore was recorded.",
      );
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null)
      child.kill();
    await handle.close().catch(() => {});
  }
}
