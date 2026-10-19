import { pgTransport } from "./pg-transport.mjs";
await pgTransport("pg_dump", process.argv.slice(2));
