// Executed only by the one-shot migration service, never the API entrypoint.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const { Client } = require("pg");
const databaseUrl = process.env.DATABASE_URL;
let client;
let child;
let interrupted = false;

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    interrupted = true;
    if (child) child.kill(signal);
  });
}

try {
  const url = new URL(databaseUrl);
  if (url.username !== "invitation_migrator")
    throw Error("Migration requires the invitation_migrator role.");
  client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  // This dedicated connection holds a database-scoped session lock until Prisma exits.
  // It must not be pooled or returned early. Every release uses the same keys.
  client.on("error", () => {
    interrupted = true;
    if (child) child.kill("SIGTERM");
  });
  await client.connect();
  const result = await client.query(
    "SELECT pg_try_advisory_lock(1783901285, 1) AS locked",
  );
  if (!result.rows[0]?.locked)
    throw Error(
      "Another migration owns the database release lock. Retry after inspection.",
    );
  if (interrupted) throw Error("Migration interrupted before execution.");
  // The bootstrap default grants permit application DML on new business tables.
  // Migration history is different: runtime must never forge a successful gate.
  const metadata = await client.query(
    "SELECT to_regclass('public._prisma_migrations') AS name",
  );
  if (metadata.rows[0]?.name)
    await client.query(
      "REVOKE ALL ON TABLE public._prisma_migrations FROM invitation_app",
    );
  console.log("Migration lock acquired; executing prisma migrate deploy.");
  // Omit Prisma diagnostics: errors may contain database URLs or SQL data.
  // Only an exit status is public; inspect _prisma_migrations privately on failure.
  const status = await new Promise((done, reject) => {
    child = spawn(
      process.execPath,
      [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
      {
        cwd: new URL("../../apps/api", import.meta.url),
        env: process.env,
        stdio: "ignore",
      },
    );
    child.once("error", () => reject(Error("Prisma could not start.")));
    child.once("close", (code) => done(code));
  });
  if (status !== 0 || interrupted)
    throw Error(
      "Prisma migrate deploy failed or was interrupted; rollout blocked. Inspect migration history privately.",
    );
  await client.query(
    "REVOKE ALL ON TABLE public._prisma_migrations FROM invitation_app",
  );
  console.log("Prisma migrate deploy succeeded.");
} catch {
  // No exception details: pg/Prisma errors can include credentials or guest data.
  console.error(
    "Migration gate failed; rollout blocked. Check role, database lock and migration history privately.",
  );
  process.exitCode = 1;
} finally {
  // Session termination releases the advisory lock even on process/container death.
  if (client) await client.end().catch(() => {});
}
