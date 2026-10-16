import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// The watcher owns this IPC channel. Even a forced watcher termination must
// not leave a detached API writing to the database indefinitely.
process.once("disconnect", () => process.exit(0));
await import(pathToFileURL(resolve(process.cwd(), "src/main.ts")).href);
