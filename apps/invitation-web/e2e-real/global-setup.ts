import { runFixtureCli } from "./smoke-fixture";

/**
 * Seeds the isolated smoke database before the real browser smoke runs.
 * Runs once in the Playwright runner, so `workers: 1` and `reuseExistingServer:
 * false` keep the seeded rows stable for the whole run.
 */
export default function globalSetup(): void {
  const result = runFixtureCli<{ status: string }>("setup");

  if (result.status !== "setup-complete") {
    throw new Error(`Smoke fixture setup did not complete: ${result.status}`);
  }
}
