import { loadDailyConfig } from "./config.mjs";
import { ownedContainer } from "./database.mjs";
import { streamArchive } from "./archive-stream.mjs";

export async function pgTransport(binary, args) {
  const config = await loadDailyConfig(),
    container = await ownedContainer(config);
  if (!container?.running)
    throw Error("Daily PostgreSQL transport is unavailable.");
  const allowed = new Set([
      "--host",
      "--port",
      "--username",
      "--file",
      "--dbname",
    ]),
    flags = new Set([
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
    ]);
  let file, database;
  const forwarded = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (allowed.has(arg)) {
      const value = args[++index];
      if (!value) throw Error("PostgreSQL transport argument is missing.");
      if (arg === "--host") {
        if (!["127.0.0.1", "localhost"].includes(value))
          throw Error("PostgreSQL transport must stay local.");
        forwarded.push(arg, "127.0.0.1");
      } else if (arg === "--port") {
        if (value !== String(config.DAILY_PG_PORT))
          throw Error("PostgreSQL transport port mismatch.");
        forwarded.push(arg, "5432");
      } else if (arg === "--username") {
        if (value !== config.operator)
          throw Error(
            "QA restore requires the provisioning role, not extra application privileges.",
          );
        forwarded.push(arg, value);
      } else if (arg === "--file") file = value;
      else {
        database = value;
        forwarded.push(arg, value);
      }
    } else if (flags.has(arg)) forwarded.push(arg);
    else if (!arg.startsWith("--")) {
      if (binary === "pg_dump" && !database) {
        database = arg;
        forwarded.push(arg);
      } else if (binary === "pg_restore" && !file) file = arg;
      else throw Error("Unsupported PostgreSQL transport argument.");
    } else throw Error("Unsupported PostgreSQL transport option.");
  }
  if (
    !/^invitation_(?:qa_[a-z0-9_]+|restore_[a-f0-9]{12})$/.test(
      database ?? "",
    ) ||
    !file
  )
    throw Error(
      "PostgreSQL backup transport refuses daily/original databases.",
    );
  await streamArchive({
    container: container.id,
    binary,
    args: forwarded,
    file,
    password: process.env.PGPASSWORD,
    timeoutMs: 60000,
  });
}
