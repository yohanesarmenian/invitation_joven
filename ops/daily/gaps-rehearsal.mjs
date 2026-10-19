import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { root, rootRequire } from "./config.mjs";
import { command, compose } from "./database.mjs";
import { runRuntimeFaults } from "./runtime-fault-rehearsal.mjs";
import { runBackupFailures } from "./backup-failure-rehearsal.mjs";

const assert = (value, message) => {
  if (!value) throw Error(message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");

export async function runGapRehearsal({
  qa,
  env,
  record,
  stopStack,
  restartStack,
}) {
  const { chromium, expect: baseExpect } = rootRequire("@playwright/test");
  const expect = baseExpect.configure({ timeout: 15_000 });
  const playwright = resolve(
    dirname(rootRequire.resolve("@playwright/test/package.json")),
    "cli.js",
  );
  let result;
  try {
    result = await command(
      process.execPath,
      [
        playwright,
        "test",
        "--config",
        "playwright.daily-gaps.config.ts",
        "--max-failures",
        "1",
      ],
      { cwd: resolve(root, "apps/admin-web"), env, timeout: 300_000 },
    );
  } catch (error) {
    await writeFile(
      resolve(root, ".local-daily/import-browser-failure.txt"),
      error.privateOutput ??
        "Import browser command failed without captured diagnostics.",
    );
    throw error;
  }
  assert(
    /\b2 passed\b/.test(stripVTControlCharacters(result)),
    "Both real CSV and XLSX browser cases must run",
  );
  record(
    "D44-real-CSV-XLSX-preview-selection-explicit-commit-and-lost-response-recovery",
  );
  const module = await import(
    pathToFileURL(resolve(root, "apps/api/scripts/admin-workflow-fixture.ts"))
      .href
  );
  const fixture = await module.createWorkflowFixture();
  let browser;
  const launch = () =>
    chromium.launch({
      headless: true,
      args: ["--disable-gpu", "--renderer-process-limit=2"],
    });
  const login = async (page, user, password) => {
    page.setDefaultTimeout(15_000);
    await page.goto(`${qa.adminOrigin}/login`);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
  };
  try {
    browser = await launch();
    const owner = await browser.newPage();
    await login(owner, fixture.owner, fixture.password);
    await owner.goto(`${qa.adminOrigin}/settings/staff`);
    const email = `gap-staff-${randomUUID()}@example.com`;
    await owner.getByLabel("Staff email", { exact: true }).fill(email);
    await owner
      .getByRole("button", { name: "Create staff account", exact: true })
      .click();
    const credential = owner.getByRole("region", {
      name: "Temporary credential",
      exact: true,
    });
    await expect(credential).toBeVisible();
    const temporary = await credential.locator("code").innerText();
    const staff = await fixture.prisma.adminUser.findUniqueOrThrow({
      where: { email },
    });
    assert(
      staff.role === "CHECKIN_STAFF" &&
        staff.mustChangePassword &&
        staff.passwordHash.startsWith("$argon2id$") &&
        !staff.passwordHash.includes(temporary),
      "Created staff must have a hash and mandatory first password change",
    );
    await owner.reload();
    await expect(
      owner.getByRole("region", { name: "Temporary credential", exact: true }),
    ).toHaveCount(0);
    record("D32-OWNER-creates-persisted-staff-temporary-password-shown-once");

    const guest = await fixture.household("Gap material persistence household");
    await owner.goto(`${qa.adminOrigin}/event-content`);
    await owner
      .getByLabel("Event", { exact: true })
      .selectOption(fixture.event.id);
    const status = owner
      .getByRole("region", { name: "Event materials editor", exact: true })
      .getByRole("status");
    await expect(status).toHaveText("Saved state loaded.");
    await owner.getByLabel("Include parking guide", { exact: true }).check();
    await owner
      .getByLabel("Parking title", { exact: true })
      .fill("Synthetic published parking");
    await owner
      .getByLabel("Parking instructions (one per line)", { exact: true })
      .fill("Synthetic guest entrance");
    await owner.getByLabel("Include event rundown", { exact: true }).check();
    await owner
      .getByLabel("Rundown title", { exact: true })
      .fill("Synthetic published rundown");
    await owner
      .getByRole("button", { name: "Add activity", exact: true })
      .click();
    await owner
      .getByLabel("Start (WIB) 1", { exact: true })
      .fill("2027-01-02T17:00");
    await owner
      .getByLabel("Activity title 1", { exact: true })
      .fill("Synthetic guest arrival");
    await owner
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(status).toHaveText(
      "Draft saved. Published content is unchanged.",
    );
    const bytes = await readFile(
      resolve(root, "apps/admin-web/e2e-real/fixtures/parking-map.png"),
    );
    await owner.getByLabel("Upload file", { exact: true }).setInputFiles({
      name: "synthetic-gap-parking.png",
      mimeType: "image/png",
      buffer: bytes,
    });
    await owner
      .getByRole("button", { name: "Upload supporting file", exact: true })
      .click();
    await expect(status).toHaveText(
      "File uploaded. Select it below, then save the draft.",
    );
    await owner
      .getByLabel("Parking map", { exact: true })
      .selectOption({ index: 1 });
    await owner
      .getByLabel("Map description", { exact: true })
      .fill("Synthetic preserved map");
    await owner
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(status).toHaveText(
      "Draft saved. Published content is unchanged.",
    );
    await owner
      .getByRole("button", { name: "Publish saved draft", exact: true })
      .click();
    await owner
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm action", exact: true })
      .click();
    await expect(owner.getByText(/Published snapshot available/)).toBeVisible();
    await owner
      .getByLabel("Parking title", { exact: true })
      .fill("Synthetic unpublished parking edit");
    await owner
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(status).toHaveText(
      "Draft saved. Published content is unchanged.",
    );
    const snapshot = async () => {
      const content = await fixture.prisma.eventContent.findUniqueOrThrow({
        where: { eventId: fixture.event.id },
      });
      const assets = await fixture.prisma.eventContentAsset.findMany({
        where: { eventId: fixture.event.id },
        orderBy: { id: "asc" },
      });
      const actor = await fixture.prisma.adminUser.findUniqueOrThrow({
        where: { id: staff.id },
      });
      return {
        content,
        assets,
        actor,
        hash: hash(JSON.stringify({ content, assets, actor })),
      };
    };
    const before = await snapshot();
    await browser.close();
    browser = undefined;
    await fixture.prisma.$disconnect();
    await restartStack();
    await fixture.prisma.$connect();
    assert(
      (await snapshot()).hash === before.hash,
      "Draft/publication/media/staff state changed after full app and DB restart",
    );
    const publicRead = await fetch(
      `${qa.apiOrigin}/api/public/invitations/${guest.publicCredential}/venue-content`,
    );
    const publicBody = await publicRead.json();
    assert(
      publicRead.ok &&
        publicBody.items[0]?.content.parking.title ===
          "Synthetic published parking",
      "Public read must retain publication rather than unpublished draft",
    );
    const assetId = before.content.published.parking.mapAssetId;
    const media = await fetch(
      `${qa.publicOrigin}/i/${guest.publicCredential}/venue-assets/${assetId}`,
    );
    assert(
      media.ok && hash(Buffer.from(await media.arrayBuffer())) === hash(bytes),
      "Public media bytes changed after restart",
    );
    record(
      "D54-full-app-PostgreSQL-restart-preserves-draft-publication-media-bytes-and-public-access",
    );

    browser = await launch();
    const staffPage = await browser.newPage();
    await login(staffPage, staff, temporary);
    await expect(staffPage).toHaveURL(`${qa.adminOrigin}/account/password`);
    const me = await staffPage
      .context()
      .request.get(`${qa.adminOrigin}/api/admin/auth/me`);
    const meBody = await me.json();
    assert(
      me.status() === 200 && meBody.user.mustChangePassword,
      "Restarted session must retain mandatory change state",
    );
    assert(
      (
        await staffPage
          .context()
          .request.post(`${qa.adminOrigin}/api/admin/checkin/validate`, {
            headers: {
              Origin: qa.adminOrigin,
              "X-CSRF-Token": meBody.csrfToken,
            },
            data: { eventId: fixture.event.id, qrPayload: guest.qrPayload },
          })
      ).status() === 403,
      "Mandatory-change staff must not scan before changing password",
    );
    await staffPage
      .getByLabel("Current password", { exact: true })
      .fill(temporary);
    await staffPage
      .getByLabel("New password", { exact: true })
      .fill("synthetic gap changed staff password");
    await staffPage
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(staffPage).toHaveURL(`${qa.adminOrigin}/checkin`);
    await staffPage
      .getByLabel("Event", { exact: true })
      .selectOption(fixture.event.id);
    await staffPage
      .getByLabel("QR code", { exact: true })
      .fill(guest.qrPayload);
    await staffPage
      .getByRole("button", { name: "Validate QR", exact: true })
      .click();
    await expect(
      staffPage.getByRole("button", { name: "Confirm check-in", exact: true }),
    ).toBeEnabled();
    assert(
      (await fixture.prisma.checkinRecord.count({
        where: { invitationId: guest.id },
      })) === 0,
      "Staff validate must stay read-only",
    );
    assert(
      !(
        await fixture.prisma.adminUser.findUniqueOrThrow({
          where: { id: staff.id },
        })
      ).mustChangePassword,
      "Password-change state did not persist",
    );
    record(
      "D32-D35-mandatory-password-change-survives-restart-and-unlocks-read-only-scanner",
    );
    await browser.close();
    browser = undefined;

    await stopStack();
    await compose(qa, [
      "up",
      "--detach",
      "--wait",
      "--wait-timeout",
      "90",
      "postgres",
    ]);
    await runRuntimeFaults({ qa, fixture, record });
    await runBackupFailures({ qa, env, fixture, record });
  } finally {
    if (browser) await browser.close();
    await fixture.prisma.$disconnect();
  }
}
