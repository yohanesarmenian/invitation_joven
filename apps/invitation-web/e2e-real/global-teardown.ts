import { rmSync } from "node:fs";
import { runFixtureCli, SMOKE_STATE_FILE } from "./smoke-fixture";

/**
 * Removes the deterministic smoke rows and the local state file. Cleanup
 * failures throw on purpose: the run must not look green while it left
 * fixture residue behind or lost track of the raw credential file.
 */
export default function globalTeardown(): void {
  const result = runFixtureCli<{ remaining: unknown; status: string }>(
    "cleanup",
  );

  rmSync(SMOKE_STATE_FILE, { force: true });

  if (result.status !== "cleanup-complete") {
    throw new Error(
      `Smoke fixture cleanup incomplete, remaining rows: ${JSON.stringify(result.remaining)}`,
    );
  }
}
