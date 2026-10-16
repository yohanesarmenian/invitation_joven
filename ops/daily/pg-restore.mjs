import { pgTransport } from "./pg-transport.mjs";
await pgTransport("pg_restore", process.argv.slice(2));
