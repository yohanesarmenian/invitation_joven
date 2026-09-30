import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "server-only": "next/dist/compiled/server-only/empty" } },
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
});
