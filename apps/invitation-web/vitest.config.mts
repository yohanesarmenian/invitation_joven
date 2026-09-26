import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Test-only: Vitest does not understand Next's `server-only` compiler alias.
    alias: {
      "server-only": "next/dist/compiled/server-only/empty",
    },
  },
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  test: {
    environment: "node",
  },
});
