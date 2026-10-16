import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  root,
  apiRequire,
  loadDailyConfig,
  dailyEnvironment,
} from "./config.mjs";
import { command } from "./database.mjs";
import { dailyStatus } from "./supervisor.mjs";

async function main() {
  const config = await loadDailyConfig();
  if (
    !["stopped", "database-only"].includes((await dailyStatus(config)).status)
  )
    throw Error("Stop daily before building its isolated .next-daily output.");
  const env = { ...dailyEnvironment(config), NODE_ENV: "production" };
  const apiDirectory = resolve(root, "apps/api");
  await command(
    process.execPath,
    [
      resolve(apiRequire.resolve("prisma/package.json"), "../build/index.js"),
      "generate",
    ],
    { cwd: apiDirectory, env },
  );
  await command(
    process.execPath,
    [apiRequire.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"],
    { cwd: apiDirectory, env },
  );
  console.log("DAILY_BUILD api");
  for (const app of ["invitation-web", "admin-web"]) {
    const directory = resolve(root, "apps", app);
    const requireApp = createRequire(resolve(directory, "package.json"));
    await command(
      process.execPath,
      [requireApp.resolve("next/dist/bin/next"), "build"],
      { cwd: directory, env, timeout: 180_000 },
    );
    console.log(`DAILY_BUILD ${app} isolated-output`);
  }
  console.log(
    "Daily builds passed; production container/HTTPS runtime was not exercised.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
