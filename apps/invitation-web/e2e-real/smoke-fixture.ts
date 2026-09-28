import { execSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Cross-process lock for the single shared 5C environment. The fixture IDs and
 * `Event.displayOrder` are deterministic on purpose, so two concurrent real
 * smokes would fight over the same rows; this lock is what makes that
 * impossible, and it is why neither has to become run-unique.
 *
 * It lives in the OS temp directory (never the repo, `dist`, `.next` or
 * `test-results`) and holds only non-secret metadata.
 */
export const SMOKE_LOCK_FILE = join(tmpdir(), "invitation-joven-5c-smoke.lock");

const ALREADY_RUNNING =
  "Real backend smoke is already running for this shared environment.";

type SmokeLockMetadata = {
  pid: number;
  startedAt: string;
};

/**
 * Claims the lock with an atomic exclusive create. `existsSync` followed by a
 * write would leave a window where two runs both see a free lock, so the
 * create itself is the test.
 */
function createSmokeLock(): boolean {
  let descriptor: number;

  try {
    descriptor = openSync(SMOKE_LOCK_FILE, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }

    throw error;
  }

  try {
    writeFileSync(
      descriptor,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
  } catch (error) {
    // Never leave a half-written lock behind for the next run to trip over.
    closeSync(descriptor);
    rmSync(SMOKE_LOCK_FILE, { force: true });
    throw error;
  }

  closeSync(descriptor);

  return true;
}

/** Returns null when the lock is missing, unreadable, or not shaped as metadata. */
function readSmokeLock(): SmokeLockMetadata | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(SMOKE_LOCK_FILE, "utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const { pid, startedAt } = parsed as Partial<SmokeLockMetadata>;

  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  return {
    pid,
    startedAt: typeof startedAt === "string" ? startedAt : "unknown",
  };
}

type ProcessState = "alive" | "dead" | "unknown";

/** Signal 0 probes liveness without delivering anything to the process. */
function probeProcess(pid: number): ProcessState {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ESRCH") {
      return "dead";
    }

    // EPERM means the pid exists but belongs to another user.
    return code === "EPERM" ? "alive" : "unknown";
  }
}

/**
 * Fails closed: a lock we cannot read or cannot prove dead is treated as live,
 * because guessing wrong here would mean two runs mutating the same rows.
 */
export function acquireSmokeLock(): void {
  if (createSmokeLock()) {
    return;
  }

  const existing = readSmokeLock();

  if (existing === null) {
    throw new Error(
      `Smoke lock ${SMOKE_LOCK_FILE} exists but is unreadable. Confirm no real backend smoke is running, then delete that file.`,
    );
  }

  if (probeProcess(existing.pid) !== "dead") {
    throw new Error(ALREADY_RUNNING);
  }

  // The previous owner is gone, so the lock is stale. Remove it and claim
  // once: a second failure means another run won the race.
  rmSync(SMOKE_LOCK_FILE, { force: true });

  if (!createSmokeLock()) {
    throw new Error(ALREADY_RUNNING);
  }
}

export function releaseSmokeLock(): void {
  const existing = readSmokeLock();

  if (existing === null) {
    if (!existsSync(SMOKE_LOCK_FILE)) {
      return;
    }

    throw new Error(
      `Smoke lock ${SMOKE_LOCK_FILE} is unreadable; refusing to delete a lock this process may not own.`,
    );
  }

  if (existing.pid !== process.pid) {
    throw new Error(
      "Smoke lock is held by another process; refusing to release it.",
    );
  }

  rmSync(SMOKE_LOCK_FILE, { force: true });
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
