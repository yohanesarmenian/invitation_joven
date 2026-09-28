import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Bridge between the Playwright real smoke and the backend-owned fixture CLI.
 * Prisma and credential derivation stay in the API package; the browser suite
 * only reads this handoff file and never touches the database itself.
 *
 * The state file lives in the OS temp directory so the raw public credential
 * never enters the repository, and it is deliberately NOT under
 * `test-results/`, which Playwright deletes at the start of every run.
 *
 * The filename is fixed rather than pid-scoped: the real suite runs with
 * `workers: 1` and global setup rewrites the file before every run, so a
 * per-pid name would only break sharing between the runner and its worker.
 */
export const SMOKE_STATE_FILE = join(
  tmpdir(),
  "invitation-joven-5c-smoke-state.json",
);

const FIXTURE_SCRIPT = "scripts/public-invitation-real-smoke-fixture.ts";

export type SmokeFixtureState = {
  beforeOpenCount: number;
  eventId: string;
  invitationId: string;
  publicCredential: string;
};

export type SmokeFixtureRead = {
  firstOpenedAtPresent: boolean;
  lastOpenedAtPresent: boolean;
  openCount: number;
};

export function runFixtureCli<T>(command: "cleanup" | "read" | "setup"): T {
  const stdout = execSync(
    [
      "pnpm",
      "--filter",
      "api",
      "exec",
      "tsx",
      FIXTURE_SCRIPT,
      command,
      "--state",
      JSON.stringify(SMOKE_STATE_FILE),
    ].join(" "),
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const lines = stdout.trim().split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return JSON.parse(lastLine) as T;
}

export function readSmokeState(): SmokeFixtureState {
  const parsed: unknown = JSON.parse(readFileSync(SMOKE_STATE_FILE, "utf8"));

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as SmokeFixtureState).publicCredential !== "string" ||
    typeof (parsed as SmokeFixtureState).invitationId !== "string" ||
    typeof (parsed as SmokeFixtureState).beforeOpenCount !== "number"
  ) {
    throw new Error("Smoke fixture state file is malformed.");
  }

  return parsed as SmokeFixtureState;
}
