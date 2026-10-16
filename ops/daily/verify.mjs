import { resolve, dirname } from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import net from "node:net";
import { poll } from "./poll.mjs";
import { pathToFileURL } from "node:url";
import {
  root,
  configPath,
  rootRequire,
  apiRequire,
  loadDailyConfig,
  dailyEnvironment,
} from "./config.mjs";
import {
  initializeDatabase,
  assertNoExistingDailyResources,
  assertDatabase,
  assertPortsAvailable,
  assertMigrations,
  command,
  withClient,
  compose,
} from "./database.mjs";
import { initializeCatalog } from "./catalog.mjs";
import { runDaily, dailyStatus, stopDaily } from "./supervisor.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const assert = (value, message) => {
  if (!value) throw Error(message);
};
async function counts(config) {
  return withClient(
    config.databaseUrl,
    async (client) =>
      (
        await client.query(
          "SELECT (SELECT count(*)::int FROM admin_users) AS admins,(SELECT count(*)::int FROM events) AS events,(SELECT count(*)::int FROM invitations) AS invitations,(SELECT count(*)::int FROM rsvps) AS rsvps,(SELECT count(*)::int FROM checkin_records) AS checkins",
        )
      ).rows[0],
  );
}

async function main() {
  const args = process.argv.slice(2);
  assert(
    args.length === 0 ||
      (args.length === 1 &&
        ["--gaps", "--events", "--backups"].includes(args[0])),
    "Unknown verification selection",
  );
  const gapsOnly = args[0] === "--gaps";
  const eventsOnly = args[0] === "--events";
  const backupsOnly = args[0] === "--backups";
  const started = Date.now(),
    config = await loadDailyConfig();
  const existing = await dailyStatus(config);
  assert(
    ["stopped", "database-only"].includes(existing.status),
    "Stop daily before verification; an existing/unknown owner will not be taken over.",
  );
  const privateHash = hash(await readFile(configPath));
  await initializeDatabase(config);
  await assertDatabase(config);
  let freshProfileRefused = false;
  try {
    await assertNoExistingDailyResources();
  } catch (error) {
    freshProfileRefused = error.message.includes(
      "no replacement secret was generated",
    );
  }
  assert(
    freshProfileRefused,
    "Existing Docker volume/container must prevent replacement-profile secret generation",
  );
  const originalCounts = await counts(config);
  const name = `invitation_qa_daily_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  assert(
    /^invitation_qa_daily_[a-f0-9]{16}$/.test(name),
    "Invalid QA identity",
  );
  const url = new URL(config.databaseUrl);
  url.pathname = `/${name}`;
  // Test-only injection into the production supervisor; the public daily
  // config parser cannot select this QA DB and its destructive test guard is unchanged.
  const qa = { ...config, database: name, databaseUrl: url.toString() };
  let created = false,
    running,
    fixture,
    browser,
    cleanupFailed = false;
  const evidence = { database: name, checks: [], elapsedMs: 0 };
  const record = (label) => {
    evidence.checks.push(label);
    console.log(`DAILY_VERIFIED ${label}`);
  };
  const originalEnvironment = { ...process.env };
  const env = {
    ...dailyEnvironment(qa),
    INVITATION_DATABASE_TESTS: "1",
    INVITATION_WORKFLOW_TEST: "1",
    INVITATION_DAILY_VERIFICATION: "1",
    PLAYWRIGHT_NO_COPY_PROMPT: "1",
  };
  try {
    await withClient(config.operatorUrl, async (client) => {
      await client.query(`CREATE DATABASE ${name} OWNER ${config.role}`);
      created = true;
      await client.query(`COMMENT ON DATABASE ${name} IS '${config.marker}'`);
    });
    const prisma = resolve(
      apiRequire.resolve("prisma/package.json"),
      "../build/index.js",
    );
    await command(process.execPath, [prisma, "migrate", "deploy"], {
      cwd: resolve(root, "apps/api"),
      env,
    });
    assert((await assertMigrations(qa)) === 5, "QA migration count changed");
    const migration = await withClient(
      qa.databaseUrl,
      async (client) =>
        (
          await client.query(
            'SELECT id, checksum FROM "_prisma_migrations" ORDER BY migration_name LIMIT 1',
          )
        ).rows[0],
    );
    try {
      await withClient(qa.databaseUrl, (client) =>
        client.query(
          'UPDATE "_prisma_migrations" SET checksum=$1 WHERE id=$2',
          ["0".repeat(64), migration.id],
        ),
      );
      let refused = false;
      try {
        await runDaily(qa);
      } catch (error) {
        refused = error.message.includes("migration history");
      }
      assert(
        refused && (await dailyStatus(qa)).status === "database-only",
        "Migration mismatch must refuse before workers start",
      );
    } finally {
      await withClient(qa.databaseUrl, (client) =>
        client.query(
          'UPDATE "_prisma_migrations" SET checksum=$1 WHERE id=$2',
          [migration.checksum, migration.id],
        ),
      );
    }
    let identityRefused = false;
    try {
      await assertDatabase({ ...qa, marker: `${qa.marker}-different-secret` });
    } catch (error) {
      identityRefused = error.message.includes("identity mismatch");
    }
    assert(
      identityRefused,
      "Changed secret/profile identity must refuse without reissue",
    );
    const wrongPasswordUrl = new URL(qa.databaseUrl);
    wrongPasswordUrl.password = randomBytes(32).toString("hex");
    let badPasswordRefused = false;
    try {
      await withClient(wrongPasswordUrl.toString(), (client) =>
        client.query("SELECT 1"),
      );
    } catch (error) {
      badPasswordRefused =
        error.message ===
        "Daily PostgreSQL operation failed. Check database health/configuration; diagnostic contents omitted.";
    }
    assert(
      badPasswordRefused,
      "Wrong database password must fail safely without a fallback",
    );
    record(
      "migration-history-and-secret-identity-mismatch-refuse-before-app-startup",
    );
    await initializeCatalog(
      qa,
      resolve(root, "ops/daily/catalog.example.json"),
    );
    const stable = await initializeCatalog(
      qa,
      resolve(root, "ops/daily/catalog.example.json"),
    );
    assert(
      stable.created === 0 && stable.unchanged === 2,
      "Catalog rerun must be a no-op",
    );
    record("catalog-atomic-initialization-and-idempotence");
    const catalogRows = () =>
      withClient(
        qa.databaseUrl,
        async (client) =>
          (await client.query("SELECT * FROM events ORDER BY id")).rows,
      );
    const catalogBefore = hash(JSON.stringify(await catalogRows()));
    const changedCatalog = JSON.parse(
      await readFile(resolve(root, "ops/daily/catalog.example.json"), "utf8"),
    );
    changedCatalog.events[0].name = "Synthetic changed catalog must refuse";
    const changedPath = resolve(
      root,
      `.local-daily/catalog-conflict-${randomUUID()}.json`,
    );
    await writeFile(changedPath, JSON.stringify(changedCatalog), {
      flag: "wx",
    });
    try {
      let refused = false;
      try {
        await initializeCatalog(qa, changedPath);
      } catch {
        refused = true;
      }
      assert(
        refused && hash(JSON.stringify(await catalogRows())) === catalogBefore,
        "Changed catalog must refuse without any row changes",
      );
    } finally {
      await unlink(changedPath);
    }
    record("changed-existing-catalog-refused-with-all-row-bytes-unchanged");
    const bootstrapEnv = {
      ...env,
      ADMIN_BOOTSTRAP_EMAIL: `bootstrap-${randomUUID()}@example.com`,
      ADMIN_BOOTSTRAP_PASSWORD: randomBytes(24).toString("base64url"),
    };
    await command(
      process.execPath,
      [rootRequire.resolve("tsx/cli"), "scripts/admin-bootstrap-owner.ts"],
      { cwd: resolve(root, "apps/api"), env: bootstrapEnv },
    );
    const refusal = await command(
      process.execPath,
      [rootRequire.resolve("tsx/cli"), "scripts/admin-bootstrap-owner.ts"],
      {
        cwd: resolve(root, "apps/api"),
        env: bootstrapEnv,
        expectedFailure: "OWNER bootstrap refused",
      },
    );
    assert(
      refusal.includes("OWNER bootstrap refused") &&
        (await counts(qa)).admins === 1,
      "OWNER bootstrap must refuse repeats",
    );
    await withClient(qa.databaseUrl, (client) =>
      client.query("DELETE FROM admin_users WHERE email=$1", [
        bootstrapEnv.ADMIN_BOOTSTRAP_EMAIL,
      ]),
    );
    record("official-owner-bootstrap-and-repeat-refusal-on-QA-only");
    Object.assign(process.env, env);
    process.chdir(resolve(root, "apps/admin-web"));
    if (eventsOnly) {
      const { runEventApiChecks } = await import("./events-rehearsal.mjs");
      await runEventApiChecks({ env, record });
    }
    const start = async () => {
      let failure;
      running = runDaily(qa).catch((error) => {
        failure = error;
      });
      await poll(
        async () => {
          if (failure) throw failure;
          const state = await dailyStatus(qa);
          if (state.status === "ready") {
            assert(state.database === name, "Owner database identity mismatch");
            return true;
          }
          return false;
        },
        120_000,
        "QA daily startup did not become ready",
      );
    };
    if (backupsOnly) {
      const { runBackupRehearsal } = await import("./backup-rehearsal.mjs");
      await runBackupRehearsal({ qa, env, record });
    } else {
      await start();
      record("production-supervisor-loopback-startup-on-isolated-QA");
      const unauth = await fetch(
        `http://127.0.0.1:${qa.DAILY_CONTROL_PORT}/stop`,
        { method: "POST" },
      );
      assert(unauth.status === 403, "Control channel must authenticate");
      record("private-control-denies-unauthenticated-shutdown");
      if (eventsOnly) {
        const { runEventRehearsal } = await import("./events-rehearsal.mjs");
        await runEventRehearsal({ env, record });
        await stopDaily(qa);
        await running;
        await compose(config, [
          "up",
          "--detach",
          "--wait",
          "--wait-timeout",
          "90",
          "postgres",
        ]);
      } else if (gapsOnly) {
        const { runGapRehearsal } = await import("./gaps-rehearsal.mjs");
        const stopStack = async () => {
          await stopDaily(qa);
          await running;
        };
        await runGapRehearsal({
          qa,
          env,
          record,
          stopStack,
          restartStack: async () => {
            await stopStack();
            await start();
          },
        });
      } else {
        const playwright = resolve(
          dirname(rootRequire.resolve("@playwright/test/package.json")),
          "cli.js",
        );
        let browserResult;
        try {
          browserResult = await command(
            process.execPath,
            [
              playwright,
              "test",
              "--config",
              "playwright.daily.config.ts",
              "--max-failures",
              "1",
            ],
            { cwd: resolve(root, "apps/admin-web"), env, timeout: 360_000 },
          );
        } catch (error) {
          await writeFile(
            resolve(root, ".local-daily/browser-failure.txt"),
            error.privateOutput ??
              "Browser command could not start; no diagnostic output available.",
          );
          throw error;
        }
        assert(
          /\b13 passed\b/.test(stripVTControlCharacters(browserResult)),
          "Expected all thirteen real browser cases to run and pass",
        );
        record(
          "real-browser-owner-staff-RSVP-messages-QR-identity-recovery-13-cases",
        );
        const module = await import(
          pathToFileURL(
            resolve(root, "apps/api/scripts/admin-workflow-fixture.ts"),
          ).href
        );
        fixture = await module.createWorkflowFixture();
        browser = await rootRequire("@playwright/test").chromium.launch({
          headless: true,
          args: ["--disable-gpu", "--renderer-process-limit=2"],
        });
        const ownerPage = await browser.newPage();
        await ownerPage.goto(`${qa.adminOrigin}/login`);
        await ownerPage
          .getByLabel("Email", { exact: true })
          .fill(fixture.owner.email);
        await ownerPage
          .getByLabel("Password", { exact: true })
          .fill(fixture.password);
        await ownerPage
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await ownerPage
          .getByRole("heading", { name: "Dashboard", exact: true })
          .waitFor();
        const noScript = await browser.newContext({
          javaScriptEnabled: false,
          storageState: await ownerPage.context().storageState(),
        });
        const noScriptPage = await noScript.newPage();
        await noScriptPage.goto(`${qa.adminOrigin}/account/password`);
        assert(
          (await noScriptPage
            .getByLabel("Current password", { exact: true })
            .isDisabled()) &&
            (await noScriptPage
              .getByLabel("New password", { exact: true })
              .isDisabled()) &&
            (await noScriptPage
              .getByRole("button", { name: "Change password", exact: true })
              .isDisabled()),
          "Password input and submit must stay disabled without hydration",
        );
        assert(
          (await noScriptPage.locator("form").getAttribute("method")) ===
            "post",
          "Native password form must never default to GET",
        );
        await noScript.close();
        record(
          "non-hydrated-password-form-blocks-input-submit-and-never-defaults-to-GET",
        );
        await ownerPage.goto(`${qa.adminOrigin}/invitations/new`);
        const displayName = `Daily UI synthetic household ${randomUUID()}`;
        await ownerPage.getByLabel("Display name (required)").fill(displayName);
        await ownerPage
          .getByLabel("Full name (required)", { exact: true })
          .fill("Synthetic Guest");
        await ownerPage.getByLabel("Allow one plus-one guest").check();
        await ownerPage
          .getByLabel("Maximum additional children (required)")
          .fill("1");
        await ownerPage.getByLabel(fixture.event.name, { exact: true }).check();
        await ownerPage
          .getByRole("button", { name: "Create invitation", exact: true })
          .click();
        await ownerPage.waitForURL(/\/invitations\?created=1$/);
        const persistedHousehold =
          await fixture.prisma.invitation.findFirstOrThrow({
            where: { displayName },
            include: { invitees: true, invitationEvents: true },
          });
        assert(
          persistedHousehold.invitees.length === 1 &&
            persistedHousehold.invitationEvents.length === 1 &&
            persistedHousehold.allowPlusOne &&
            persistedHousehold.maxAdditionalChildren === 1,
          "UI-created household did not persist its quota/invitees/eligibility",
        );
        await ownerPage.goto(
          `${qa.adminOrigin}/invitations/${persistedHousehold.id}`,
        );
        await ownerPage
          .getByRole("button", { name: "View public link", exact: true })
          .click();
        const publicUrl = new URL(
          (await ownerPage.locator("#publicUrl").inputValue()).trim(),
        );
        assert(
          publicUrl.origin === qa.publicOrigin,
          "UI link used a different public profile",
        );
        const household = {
          id: persistedHousehold.id,
          publicCredential: publicUrl.pathname.split("/").at(-1),
        };
        await ownerPage.close();
        assert(
          (await fixture.prisma.checkinPass.count({
            where: { invitationId: household.id },
          })) === 0,
          "OWNER creation must not pre-issue a pass",
        );
        record(
          "OWNER-browser-creates-household-quotas-invitee-eligibility-and-current-link",
        );
        const guest = await browser.newPage({ reducedMotion: "reduce" });
        await guest.goto(`${qa.publicOrigin}/i/${household.publicCredential}`, {
          waitUntil: "domcontentloaded",
        });
        await guest
          .getByRole("button", { name: "Open invitation", exact: true })
          .click();
        await guest
          .getByRole("button", { name: "View invitation", exact: true })
          .click();
        await guest.getByRole("radio", { name: "Joyfully Accept" }).check();
        await guest
          .getByRole("checkbox", { name: "Synthetic Guest", exact: true })
          .check();
        await guest
          .getByRole("checkbox", { name: fixture.event.name, exact: true })
          .check();
        await guest
          .getByRole("button", { name: "Send RSVP", exact: true })
          .click();
        await guest.locator(".checkin-code").waitFor();
        const qr = (await guest.locator(".checkin-code").innerText()).trim();
        await guest.getByLabel(/Your name/).fill("Daily synthetic guest");
        await guest
          .getByLabel(/Your message/)
          .fill("Persistent synthetic message");
        await guest.getByRole("button", { name: /^Send Message$/ }).click();
        await poll(
          async () =>
            (await fixture.prisma.guestMessage.count({
              where: { invitationId: household.id },
            })) === 1,
          10_000,
          "Message was not persisted",
        );
        const staff = await browser.newPage();
        await staff.goto(`${qa.adminOrigin}/login`);
        await staff
          .getByLabel("Email", { exact: true })
          .fill(fixture.staff.email);
        await staff
          .getByLabel("Password", { exact: true })
          .fill(fixture.password);
        await staff
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await staff
          .getByLabel("Event", { exact: true })
          .selectOption(fixture.event.id);
        await staff.getByLabel("QR code", { exact: true }).fill(qr);
        await staff
          .getByRole("button", { name: "Validate QR", exact: true })
          .click();
        await staff
          .getByRole("button", { name: "Confirm check-in", exact: true })
          .click();
        await staff
          .getByRole("heading", { name: "Check-in confirmed", exact: true })
          .waitFor();
        const snapshot = async () => {
          const rsvp = await fixture.prisma.rSVP.findUniqueOrThrow({
            where: { invitationId: household.id },
            include: { attendees: true, eventSelections: true },
          });
          const pass = await fixture.prisma.checkinPass.findFirstOrThrow({
            where: { invitationId: household.id, status: "ACTIVE" },
          });
          const message = await fixture.prisma.guestMessage.findFirstOrThrow({
            where: { invitationId: household.id },
          });
          const checkin = await fixture.prisma.checkinRecord.findFirstOrThrow({
            where: { invitationId: household.id },
          });
          return hash(JSON.stringify({ rsvp, pass, message, checkin }));
        };
        const persisted = await snapshot();
        await browser.close();
        browser = undefined;
        await fixture.prisma.$disconnect();
        await stopDaily(qa);
        await running;
        assert(
          (await dailyStatus(qa)).status === "stopped",
          "Shutdown did not stop owned resources",
        );
        record(
          "authenticated-shutdown-stops-owned-workers-and-preserves-volume",
        );
        await start();
        await fixture.prisma.$connect();
        assert(
          (await snapshot()) === persisted,
          "Persisted data changed after full restart",
        );
        const response = await fetch(
          `${qa.apiOrigin}/api/public/invitations/${household.publicCredential}/rsvp`,
        );
        const canonical = await response.json();
        assert(
          JSON.stringify(canonical).includes(qr),
          "Issued QR did not survive restart",
        );
        record(
          "guest-issued-pass-RSVP-message-checkin-and-operator-survive-full-restart",
        );
        browser = await rootRequire("@playwright/test").chromium.launch({
          headless: true,
          args: ["--disable-gpu", "--renderer-process-limit=2"],
        });
        for (const [user, destination] of [
          [fixture.owner, "Dashboard"],
          [fixture.staff, "Check-in"],
        ]) {
          const page = await browser.newPage();
          await page.goto(`${qa.adminOrigin}/login`);
          await page.getByLabel("Email", { exact: true }).fill(user.email);
          await page
            .getByLabel("Password", { exact: true })
            .fill(fixture.password);
          await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
          if (destination === "Dashboard")
            await page
              .getByRole("heading", { name: destination, exact: true })
              .waitFor();
          else await page.waitForURL(`${qa.adminOrigin}/checkin`);
          await page.close();
        }
        await browser.close();
        browser = undefined;
        record("OWNER-and-staff-real-login-after-full-restart");
        // Preserve this complete synthetic dataset until the exact QA database is
        // dropped in finally. It is never registered as a daily user fixture.
        await fixture.prisma.$disconnect();
        fixture = undefined;
        await stopDaily(qa);
        await running;
        // DB stays separate: startup after down legitimately restores its owned volume.
        await compose(config, [
          "up",
          "--detach",
          "--wait",
          "--wait-timeout",
          "90",
          "postgres",
        ]);
        const operatorUrl = new URL(config.operatorUrl);
        operatorUrl.pathname = `/${name}`;
        await command(
          process.execPath,
          [rootRequire.resolve("tsx/cli"), "scripts/local-backup-rehearsal.ts"],
          {
            cwd: resolve(root, "apps/api"),
            env: {
              ...env,
              DATABASE_URL: operatorUrl.toString(),
              PG_DUMP_NODE_WRAPPER: resolve(root, "ops/daily/pg-dump.mjs"),
              PG_RESTORE_NODE_WRAPPER: resolve(
                root,
                "ops/daily/pg-restore.mjs",
              ),
            },
            timeout: 120_000,
          },
        );
        record(
          "existing-real-backup-restore-rehearsal-with-PG18-container-tools",
        );
      }
    }
    assert(
      hash(await readFile(configPath)) === privateHash,
      "Private daily config changed",
    );
    assert(
      JSON.stringify(await counts(config)) === JSON.stringify(originalCounts),
      "Daily user data changed during QA",
    );
    record("daily-config-and-user-dataset-unchanged-by-QA");
    // A foreign server occupies a target port; supervisor must refuse and leave it alive.
    const blocker = net.createServer();
    await new Promise((done, reject) => {
      blocker.once("error", reject);
      blocker.listen(qa.DAILY_PUBLIC_PORT, "127.0.0.1", done);
    });
    let portRefused = false;
    try {
      await runDaily(qa);
    } catch {
      portRefused = true;
    }
    assert(
      portRefused && blocker.listening,
      "Occupied foreign port was not preserved",
    );
    await new Promise((done) => blocker.close(done));
    record("foreign-port-conflict-refused-without-kill");
    const { pgTransport } = await import("./pg-transport.mjs");
    let restoreRefused = false;
    try {
      await pgTransport("pg_restore", [
        "--host",
        "127.0.0.1",
        "--port",
        String(config.DAILY_PG_PORT),
        "--username",
        config.operator,
        "--dbname",
        config.database,
        "nonexistent-synthetic-backup.dump",
      ]);
    } catch (error) {
      restoreRefused = error.message.includes(
        "refuses daily/original databases",
      );
    }
    assert(
      restoreRefused &&
        JSON.stringify(await counts(config)) === JSON.stringify(originalCounts),
      "Restore to daily must refuse before any transport or write",
    );
    record("actual-backup-transport-refuses-daily-restore-before-spawn");
    // Validate the unchanged test safety gate against daily, with the opt-in flag set.
    const guardOutput = await command(
      process.execPath,
      [
        resolve(
          dirname(rootRequire.resolve("vitest/package.json")),
          "vitest.mjs",
        ),
        "run",
        "src/runtime/listen-config.spec.ts",
        "--maxWorkers",
        "1",
      ],
      {
        cwd: resolve(root, "apps/api"),
        env: { ...dailyEnvironment(config), INVITATION_DATABASE_TESTS: "1" },
        timeout: 30_000,
        expectedFailure: "Refusing database tests",
      },
    );
    assert(
      guardOutput.includes("Refusing database tests"),
      "Destructive tests must refuse the daily database",
    );
    record("database-test-guard-refuses-daily-even-with-test-flag");
  } finally {
    try {
      if (browser) await browser.close();
      if (running) {
        await stopDaily(qa);
        await running;
      }
      const finalState = await dailyStatus(qa);
      assert(
        ["stopped", "database-only"].includes(finalState.status),
        "QA runtime ownership unresolved; retain database for recovery",
      );
      await assertPortsAvailable([
        qa.DAILY_PUBLIC_PORT,
        qa.DAILY_ADMIN_PORT,
        qa.DAILY_API_PORT,
        qa.DAILY_CONTROL_PORT,
      ]);
      // Cleanup is exact and QA-only. Never restore/drop invitation_daily.
      if (fixture) await fixture.prisma.$disconnect();
      if (created) {
        const owned = await import("./database.mjs").then((module) =>
          module.ownedContainer(config),
        );
        if (!owned?.running)
          await compose(config, [
            "up",
            "--detach",
            "--wait",
            "--wait-timeout",
            "90",
            "postgres",
          ]);
        await withClient(config.operatorUrl, async (client) => {
          await client.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
            [name],
          );
          await client.query(`DROP DATABASE ${name}`);
        });
      }
    } catch {
      await writeFile(
        resolve(root, ".local-daily/verification-cleanup-pending.json"),
        JSON.stringify(
          {
            database: name,
            created,
            reason:
              "QA cleanup or ownership verification incomplete; do not claim success",
          },
          null,
          2,
        ),
      );
      cleanupFailed = true;
    } finally {
      for (const key of Object.keys(process.env))
        if (!(key in originalEnvironment)) delete process.env[key];
      Object.assign(process.env, originalEnvironment);
    }
  }
  if (cleanupFailed)
    throw Error(
      "QA cleanup incomplete; exact QA identity retained privately for explicit recovery.",
    );
  evidence.elapsedMs = Date.now() - started;
  await writeFile(
    resolve(
      root,
      gapsOnly
        ? ".local-daily/verification-gaps.json"
        : eventsOnly
          ? ".local-daily/verification-events.json"
          : backupsOnly
            ? ".local-daily/verification-backups.json"
            : ".local-daily/verification.json",
    ),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      status: "verified",
      checks: evidence.checks.length,
      elapsedMs: evidence.elapsedMs,
    }),
  );
}
main().catch((error) => {
  console.error(
    "Daily verification failed. Private outputs/credentials omitted; inspect stage labels and owned runtime status.",
  );
  if (/^[A-Z_]+$/.test(error?.code ?? ""))
    console.error(`Failure code: ${error.code}`);
  process.exitCode = 1;
});
