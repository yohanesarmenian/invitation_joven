import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const rootRequire = createRequire(resolve(root, "package.json"));
const source = apiRequire("dotenv").parse(
  readFileSync(resolve(root, "apps/api/.env")),
);
const database = process.env.INVITATION_QA_DATABASE_NAME;
if (!database || !/^invitation_qa_[a-z0-9_]+$/.test(database))
  throw Error(
    "Set INVITATION_QA_DATABASE_NAME to an existing, migrated, isolated invitation_qa_* database.",
  );
const url = new URL(source.DATABASE_URL ?? "invalid:");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw Error("Local journey requires a loopback PostgreSQL server.");
url.pathname = `/${database}`;
const mode = process.argv[2];
const next = (app) =>
  resolve(root, `apps/${app}/node_modules/next/dist/bin/next`);
const commands = {
  api: ["api", ["dist/main.js"]],
  admin: [
    "admin-web",
    [next("admin-web"), "dev", "--hostname", "127.0.0.1", "--port", "3101"],
  ],
  guest: [
    "invitation-web",
    [
      next("invitation-web"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3100",
    ],
  ],
  fixture: [
    "admin-web",
    [rootRequire.resolve("tsx/cli"), "scripts/local-journey-fixture.ts"],
  ],
  test: [
    "admin-web",
    [
      resolve(
        dirname(rootRequire.resolve("@playwright/test/package.json")),
        "cli.js",
      ),
      "test",
      "--config",
      "playwright.journey.config.ts",
      ...process.argv.slice(3),
    ],
  ],
};
if (!Object.hasOwn(commands, mode))
  throw Error("Choose api, admin, guest, fixture, or test.");
const [app, args] = commands[mode];
const child = spawn(process.execPath, args, {
  cwd: resolve(root, "apps", app),
  windowsHide: true,
  stdio: mode === "fixture" ? ["pipe", "inherit", "inherit"] : "inherit",
  env: {
    ...process.env,
    ...source,
    NODE_ENV: "development",
    DATABASE_URL: url.toString(),
    INVITATION_DATABASE_TESTS: "1",
    INVITATION_WORKFLOW_TEST: "1",
    ADMIN_ORIGIN: "http://localhost:3101",
    PUBLIC_INVITATION_BASE_URL: "http://localhost:3100",
    ADMIN_API_INTERNAL_BASE_URL: "http://127.0.0.1:4100",
    INVITATION_API_BASE_URL: "http://127.0.0.1:4100",
    NEXT_QA_DIST_DIR: ".next-journey",
    RAYON_NUM_THREADS: "2",
    PORT: "4100",
  },
});
if (mode === "fixture") {
  process.stdin.on("data", (data) => child.stdin.write(data));
  // Windows process.kill(SIGINT) terminates the child instead of delivering a
  // graceful signal. Use its owned stdin channel to request fixture cleanup.
  process.once("SIGINT", () => child.stdin.end("cleanup\n"));
} else process.once("SIGINT", () => child.kill("SIGINT"));
child.once("error", () => {
  console.error("Unable to start local journey process.");
  process.exitCode = 1;
});
child.once("exit", (code) => {
  if (mode === "fixture") process.stdin.pause();
  process.exitCode = code ?? 1;
});
