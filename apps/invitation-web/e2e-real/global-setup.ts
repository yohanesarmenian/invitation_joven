import {
  acquireSmokeLock,
  message,
  releaseSmokeLock,
  runFixtureCli,
} from "./smoke-fixture";

/**
 * Seeds the isolated smoke database before the real browser smoke runs.
 * Runs once in the Playwright runner, so `workers: 1` and `reuseExistingServer:
 * false` keep the seeded rows stable for the whole run.
 *
 * The lock is taken before the fixture CLI runs, so a second concurrent
 * invocation is rejected before it can touch a single row.
 */
export default function globalSetup(): void {
  acquireSmokeLock();

  try {
    const result = runFixtureCli<{ status: string }>("setup");

    if (result.status !== "setup-complete") {
      throw new Error(`Smoke fixture setup did not complete: ${result.status}`);
    }
  } catch (error) {
    // Released here as well as in teardown so a failed setup cannot leave the
    // shared environment locked if teardown never gets to run. A release
    // failure is reported but must not replace the setup failure.
    try {
      releaseSmokeLock();
    } catch (releaseError) {
      process.stderr.write(
        `Smoke lock release after setup failure also failed: ${message(releaseError)}\n`,
      );
    }

    throw error;
  }
}
