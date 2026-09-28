import { rmSync } from "node:fs";
import {
  message,
  releaseSmokeLock,
  runFixtureCli,
  SMOKE_STATE_FILE,
} from "./smoke-fixture";

/**
 * Removes the deterministic smoke rows, the local credential state file, and
 * the cross-process smoke lock.
 *
 * Every step is attempted even when an earlier one fails, and no failure is
 * allowed to silently replace another: the database failure stays the headline
 * while the secondary ones are appended. Cleanup failures throw on purpose -
 * the run must not look green while it left fixture residue, a raw credential
 * file, or a stale lock behind.
 */
export default function globalTeardown(): void {
  const secondaryFailures: string[] = [];
  let cleanupFailure: string | null = null;

  try {
    const result = runFixtureCli<{ remaining: unknown; status: string }>(
      "cleanup",
    );

    if (result.status !== "cleanup-complete") {
      cleanupFailure = `Smoke fixture cleanup incomplete, remaining rows: ${JSON.stringify(result.remaining)}`;
    }
  } catch (error) {
    cleanupFailure = `Smoke fixture cleanup failed: ${message(error)}`;
  }

  // The state file holds the raw public credential, so it is removed even when
  // the database cleanup above failed or reported an incomplete status.
  try {
    rmSync(SMOKE_STATE_FILE, { force: true });
  } catch (error) {
    secondaryFailures.push(`state file removal failed: ${message(error)}`);
  }

  try {
    releaseSmokeLock();
  } catch (error) {
    secondaryFailures.push(`smoke lock release failed: ${message(error)}`);
  }

  const failures =
    cleanupFailure === null
      ? secondaryFailures
      : [cleanupFailure, ...secondaryFailures];

  if (failures.length > 0) {
    throw new Error(failures.join(" "));
  }
}
