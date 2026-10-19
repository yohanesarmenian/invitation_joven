import { spawn, fork } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID, randomInt } from "node:crypto";
import {
  root,
  rootRequire,
  dailyEnvironment,
  redactDailyOutput,
} from "./config.mjs";
import {
  assertDatabase,
  assertPortsAvailable,
  withClient,
  pgClient,
} from "./database.mjs";
import { deadline } from "./supervisor.mjs";
import { poll } from "./poll.mjs";

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export async function runRuntimeFaults({ qa, fixture, record }) {
  assert(
    /^invitation_qa_daily_[a-f0-9]{16}$/.test(qa.database),
    "Runtime faults require exact disposable QA identity",
  );
  await assertDatabase(qa);
  const appName = `gap_api_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(qa.databaseUrl);
  url.searchParams.set("application_name", appName);
  const env = { ...dailyEnvironment(qa), DATABASE_URL: url.toString() };
  let api,
    publicWorker,
    browser,
    logs = "";
  const collect = (data) => {
    logs = (logs + redactDailyOutput(data.toString(), qa)).slice(-16_384);
  };
  const track = (child) => {
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const closed = new Promise((done) =>
      child.once("close", (code) => done(code)),
    );
    child.once("error", () => {});
    return { child, closed };
  };
  const stop = async (owner, signal = "SIGTERM") => {
    if (!owner) return;
    if (owner.child.exitCode === null && owner.child.signalCode === null)
      owner.child.kill(signal);
    try {
      await deadline(owner.closed, 10_000, "Owned API did not exit");
    } catch {
      owner.child.kill("SIGKILL");
      await deadline(owner.closed, 5000, "Owned API cleanup unresolved");
    }
  };
  const healthy = async () => {
    try {
      return (
        await fetch(`${qa.apiOrigin}/health`, {
          signal: AbortSignal.timeout(2000),
        })
      ).ok;
    } catch {
      return false;
    }
  };
  const startApi = async () => {
    await assertPortsAvailable([qa.DAILY_API_PORT]);
    api = track(
      spawn(process.execPath, [resolve(root, "apps/api/dist/main.js")], {
        cwd: resolve(root, "apps/api"),
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    await poll(
      async () => {
        if (api.child.exitCode !== null)
          throw Error("Owned test API exited before readiness");
        return healthy();
      },
      30_000,
      "Owned API readiness timeout",
    );
  };
  const request = async (path, body, auth) => {
    const response = await fetch(`${qa.apiOrigin}${path}`, {
      method:
        body === undefined ? "GET" : path.endsWith("/rsvp") ? "PUT" : "POST",
      headers: {
        Origin: qa.adminOrigin,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const login = async () => {
    const result = await request("/api/admin/auth/login", {
      email: fixture.staff.email,
      password: fixture.password,
    });
    assert(
      result.status === 200 && result.cookie && result.body.csrfToken,
      "Staff HTTP login failed",
    );
    return { cookie: result.cookie, csrf: result.body.csrfToken };
  };
  const pendingBody = async (household) => {
    const invitee = await fixture.prisma.invitee.findFirstOrThrow({
      where: { invitationId: household.id },
    });
    return {
      expectedVersion: null,
      status: "ACCEPTED",
      attendees: [
        { type: "NAMED_INVITEE", inviteeId: invitee.id, quantity: 1 },
      ],
      eventSelections: [
        {
          eventId: fixture.event.id,
          attending: true,
          expectedAttendeeCount: 1,
        },
      ],
      dietaryNotes: null,
    };
  };
  async function crashAfterInsert(table, invitationId, send) {
    assert(
      ["rsvps", "checkin_records"].includes(table) &&
        /^[a-f0-9-]{36}$/.test(invitationId),
      "Unrecognized QA lock target",
    );
    const suffix = randomUUID().replaceAll("-", "");
    const name = `qa_gap_hold_${suffix}`,
      key = 8_100_000_000 + randomInt(1_000_000);
    const blocker = pgClient(qa.databaseUrl);
    let installed = false,
      pending;
    try {
      await blocker.connect();
      await blocker.query("SELECT pg_advisory_lock($1::bigint)", [key]);
      await withClient(qa.databaseUrl, async (client) => {
        await client.query(
          `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.invitation_id='${invitationId}'::uuid THEN PERFORM pg_advisory_xact_lock(${key}::bigint); END IF; RETURN NEW; END $$`,
        );
        installed = true;
        await client.query(
          `CREATE TRIGGER ${name} AFTER INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`,
        );
      });
      pending = send()
        .then((value) => ({ completed: true, status: value.status }))
        .catch(() => ({ completed: false }));
      await poll(
        () =>
          withClient(
            qa.databaseUrl,
            async (client) =>
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND wait_event='advisory' AND xact_start IS NOT NULL",
                  [appName],
                )
              ).rows[0].n === 1,
          ),
        3500,
        "Production INSERT did not reach the held QA transaction lock",
      );
      // This is the ChildProcess handle created above, never a discovered PID.
      await stop(api, "SIGKILL");
      api = undefined;
      await blocker.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
      const outcome = await pending;
      assert(
        !outcome.completed,
        "Killed in-flight API must not return success",
      );
      await poll(
        () =>
          withClient(
            qa.databaseUrl,
            async (client) =>
              (
                await client.query(
                  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1",
                  [appName],
                )
              ).rows[0].n === 0,
          ),
        5000,
        "Killed API database sessions did not close",
      );
      assert(
        (await fixture.prisma[
          table === "rsvps" ? "rSVP" : "checkinRecord"
        ].count({ where: { invitationId } })) === 0,
        "Uncommitted INSERT survived API process death",
      );
    } finally {
      // If a test fails while blocked, terminate only our API before releasing
      // its lock so that cleanup cannot accidentally commit the pending write.
      if (pending) {
        await stop(api, "SIGKILL");
        api = undefined;
      }
      await blocker.end();
      if (installed)
        await withClient(qa.databaseUrl, async (client) => {
          await client.query(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
          await client.query(`DROP FUNCTION ${name}()`);
        });
      if (pending) await pending;
    }
  }
  try {
    await startApi();
    await assertPortsAvailable([qa.DAILY_PUBLIC_PORT]);
    publicWorker = track(
      fork(resolve(root, "ops/daily/worker.mjs"), [], {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }),
    );
    const started = new Promise((done, reject) =>
      publicWorker.child.on("message", (message) => {
        if (message.type === "started") done();
        if (message.type === "failed")
          reject(Error("Owned public worker failed"));
      }),
    );
    publicWorker.child.send({
      type: "start",
      root,
      app: "invitation-web",
      port: qa.DAILY_PUBLIC_PORT,
    });
    await deadline(started, 60_000, "Owned public worker startup timeout");
    const { chromium, expect: baseExpect } = rootRequire("@playwright/test"),
      expect = baseExpect.configure({ timeout: 15_000 });
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-gpu", "--renderer-process-limit=2"],
    });
    const guest = await browser.newPage({ reducedMotion: "reduce" });
    const household = await fixture.household("Synthetic API-off guest", {
      pending: true,
    });
    await guest.goto(`${qa.publicOrigin}/i/${household.publicCredential}`);
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
    await guest.getByLabel(/Your name/).fill("Synthetic outage guest");
    await guest.getByLabel(/Your message/).fill("Synthetic outage message");
    await stop(api);
    api = undefined;
    await guest.getByRole("button", { name: "Send RSVP", exact: true }).click();
    await expect(
      guest.getByRole("heading", {
        name: "Your response couldn’t be saved",
        exact: true,
      }),
    ).toBeVisible();
    await expect(guest.locator(".checkin-code")).toHaveCount(0);
    await guest
      .getByRole("button", { name: "Send Message", exact: true })
      .click();
    await expect(
      guest.getByText(
        "We couldn’t confirm whether your message was sent. Your words are still here. Sending again may send another copy.",
        { exact: true },
      ),
    ).toBeVisible();
    const empty = async () =>
      (await fixture.prisma.rSVP.count({
        where: { invitationId: household.id },
      })) === 0 &&
      (await fixture.prisma.guestMessage.count({
        where: { invitationId: household.id },
      })) === 0 &&
      (await fixture.prisma.checkinPass.count({
        where: { invitationId: household.id },
      })) === 0;
    assert(await empty(), "API-off submissions wrote data or invented a pass");
    await startApi();
    await pause(1200);
    assert(await empty(), "API recovery caused an automatic queued write");
    await expect(
      guest.getByRole("radio", { name: "Joyfully Accept" }),
    ).toBeChecked();
    await expect(guest.getByLabel(/Your message/)).toHaveValue(
      "Synthetic outage message",
    );
    await guest.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(guest.locator(".checkin-code")).toBeVisible();
    // Message recovery uses its own form/button and an explicit user gesture.
    const messageForm = guest.getByRole("form", {
      name: "Guest message",
      exact: true,
    });
    await messageForm.getByRole("button").click();
    await poll(
      async () =>
        (await fixture.prisma.guestMessage.count({
          where: { invitationId: household.id },
        })) === 1,
      10_000,
      "Explicit message retry did not persist exactly once",
    );
    assert(
      (await fixture.prisma.rSVP.count({
        where: { invitationId: household.id },
      })) === 1 &&
        (await fixture.prisma.checkinPass.count({
          where: { invitationId: household.id },
        })) === 1,
      "Explicit RSVP retry did not issue exactly one persisted state/pass",
    );
    record(
      "D66-real-API-off-guest-RSVP-message-safe-errors-no-pass-no-auto-replay-explicit-retry",
    );
    await browser.close();
    browser = undefined;

    const crashGuest = await fixture.household(
      "Synthetic in-flight crash household",
      { pending: true },
    );
    const body = await pendingBody(crashGuest);
    const rsvpPath = `/api/public/invitations/${crashGuest.publicCredential}/rsvp`;
    await crashAfterInsert("rsvps", crashGuest.id, () =>
      request(rsvpPath, body),
    );
    assert(
      (await fixture.prisma.checkinPass.count({
        where: { invitationId: crashGuest.id },
      })) === 0,
      "Crashed RSVP left a partial pass",
    );
    await startApi();
    const authoritative = await request(rsvpPath);
    assert(
      authoritative.status === 200 &&
        authoritative.body.rsvp === null &&
        authoritative.body.checkinPass === null,
      "Authoritative RSVP after crash must stay pending without a pass",
    );
    const accepted = await request(rsvpPath, body);
    assert(
      accepted.status === 200 &&
        accepted.body.rsvp.version === 1 &&
        accepted.body.checkinPass?.qrPayload,
      "Explicit RSVP retry after rollback must create version one and a pass",
    );
    record(
      "D60-real-API-kill-after-RSVP-INSERT-before-commit-rolls-back-and-explicit-retry-saves-once",
    );
    const auth = await login();
    const confirm = {
      eventId: fixture.event.id,
      attendeeCount: 1,
      qrPayload: accepted.body.checkinPass.qrPayload,
    };
    await crashAfterInsert("checkin_records", crashGuest.id, () =>
      request("/api/admin/checkin/confirm", confirm, auth),
    );
    await startApi();
    const authAfter = await login();
    const status = await request(
      "/api/admin/checkin/manual-status",
      { invitationId: crashGuest.id, eventId: fixture.event.id },
      authAfter,
    );
    assert(
      status.status === 200 && status.body.status === "NOT_CONFIRMED",
      "Authoritative check-in status after rollback must be NOT_CONFIRMED",
    );
    const explicit = await request(
      "/api/admin/checkin/confirm",
      confirm,
      authAfter,
    );
    assert(
      explicit.status === 201,
      "Explicit confirm after authoritative recovery failed",
    );
    const records = await fixture.prisma.checkinRecord.findMany({
      where: { invitationId: crashGuest.id, eventId: fixture.event.id },
    });
    assert(
      records.length === 1 &&
        records[0].confirmedByAdminUserId === fixture.staff.id &&
        records[0].attendeeCount === 1,
      "Crash recovery must persist exactly one confirmation and the real session operator",
    );
    record(
      "D60-real-API-kill-after-checkin-INSERT-before-commit-exact-status-and-one-explicit-confirm",
    );
  } catch (error) {
    await writeFile(
      resolve(root, ".local-daily/runtime-fault-failure.json"),
      JSON.stringify(
        {
          reason: redactDailyOutput(error.message, qa).slice(0, 2000),
          logTail: logs,
        },
        null,
        2,
      ),
    );
    throw Error(
      "Runtime fault rehearsal failed; private stage diagnostics retained.",
    );
  } finally {
    if (browser) await browser.close();
    await stop(api);
    if (publicWorker) {
      if (publicWorker.child.connected)
        publicWorker.child.send({ type: "stop" });
      await deadline(
        publicWorker.closed,
        15_000,
        "Owned public worker cleanup unresolved",
      );
    }
    await assertPortsAvailable([qa.DAILY_API_PORT, qa.DAILY_PUBLIC_PORT]);
  }
}
