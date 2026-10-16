import {
  access,
  mkdir,
  readFile,
  writeFile,
  unlink,
  rm,
} from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import {
  root,
  dailyDirectory,
  configPath,
  loadDailyConfig,
} from "./config.mjs";
import { command, dockerBinary } from "./database.mjs";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function main() {
  await loadDailyConfig();
  const started = Date.now(),
    id = randomUUID();
  const directory = resolve(dailyDirectory, `context-${id}`);
  // This exact, newly created directory is the only recursive cleanup target.
  const within = relative(dailyDirectory, directory);
  if (
    isAbsolute(within) ||
    within.startsWith("..") ||
    within !== `context-${id}`
  )
    throw Error("Context verification ownership is unresolved.");
  await mkdir(directory);
  const output = resolve(directory, "export"),
    files = [];
  const marker = async (path) => {
    await writeFile(path, "synthetic-daily-context-marker\n", { flag: "wx" });
    files.push(path);
  };
  const environmentMarker = resolve(root, `.env.daily-context-${id}`);
  const backupMarker = resolve(root, `daily-context-${id}.dump`);
  const checks = [];
  let cleanupFailed = false;
  try {
    await marker(environmentMarker);
    await marker(backupMarker);
    const journey = resolve(root, ".local-journey.json");
    if (!(await exists(journey))) await marker(journey);
    for (const name of [".next-daily", ".next-journey"]) {
      const path = resolve(root, "apps/invitation-web", name);
      if (!(await exists(path)))
        throw Error("Expected existing isolated output is missing.");
      await marker(resolve(path, `context-${id}.txt`));
    }
    const dockerfile = resolve(directory, "Dockerfile");
    await writeFile(dockerfile, "FROM scratch\nCOPY . /workspace\n", {
      flag: "wx",
    });
    await command(
      await dockerBinary(),
      [
        "build",
        "--no-cache",
        "--file",
        dockerfile,
        "--output",
        `type=local,dest=${output}`,
        ".",
      ],
      { timeout: 180_000 },
    );
    const workspace = resolve(output, "workspace");
    for (const path of [
      configPath,
      environmentMarker,
      backupMarker,
      journey,
      dailyDirectory,
      resolve(root, "apps/invitation-web/.next-daily"),
      resolve(root, "apps/invitation-web/.next-journey"),
      resolve(root, "apps/api/.env"),
    ]) {
      if (await exists(resolve(workspace, relative(root, path))))
        throw Error(
          "Private path unexpectedly entered Docker context; export retained privately.",
        );
    }
    const source = "ops/daily/config.mjs";
    if (
      !(await readFile(resolve(workspace, source))).equals(
        await readFile(resolve(root, source)),
      )
    )
      throw Error("Docker context did not contain the expected source bytes.");
    checks.push(
      "real-Docker-build-context-excludes-private-config-runtime-QA-output-and-backup",
      "source-bytes-present-in-scratch-export-no-production-image-claim",
    );
  } finally {
    // A cleanup error propagates; it cannot turn a failed cleanup into a pass.
    const results = await Promise.allSettled(files.map((path) => unlink(path)));
    cleanupFailed = results.some((result) => result.status === "rejected");
  }
  if (cleanupFailed)
    throw Error(
      "Context marker cleanup incomplete; retained ownership directory for inspection.",
    );
  await rm(directory, { recursive: true });
  const report = { checks, elapsedMs: Date.now() - started };
  await writeFile(
    resolve(dailyDirectory, "context-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ status: "verified", ...report }));
}
main().catch(() => {
  console.error(
    "Docker context verification failed; inspect the private context directory. No image readiness claim was made.",
  );
  process.exitCode = 1;
});
