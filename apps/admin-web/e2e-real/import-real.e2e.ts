import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const helperPath = resolve(__dirname, "live-import-db.cjs");
const commitPath = "**/api/admin/imports/guest/commit";
const runId = `live${Date.now().toString(36)}`;

type Setup = {
  adminOrigin: string;
  ceremonySlug: string;
  database: {
    database: string;
    host: string;
    port: string;
  };
  duplicateName: string;
  email: string;
  inactiveSlug: string;
  password: string;
  receptionSlug: string;
  runId: string;
  sessionCookie: string;
};
type Snapshot = {
  counts: Record<string, number>;
  imports: Array<{
    batchId: string | null;
    committedBatchId: string | null;
    createdInvitationCount: number | null;
    createdInviteeCount: number | null;
    hasCommitFingerprint: boolean;
    previewId: string;
    previewStatus: string;
    sourceFormat: string | null;
    warningCount: number | null;
  }>;
  scopedInvitations: Array<{
    allowPlusOne: boolean;
    displayName: string;
    events: Array<{ isActive: boolean; slug: string }>;
    greetingName: string | null;
    hasPublicTokenHash: boolean;
    invitees: Array<{
      category: string;
      displayOrder: number;
      fullName: string;
      label: string | null;
    }>;
    maxAdditionalChildren: number;
    notes: string | null;
    rsvpCount: number;
    rsvpDeadlineAt: string | null;
    status: string;
  }>;
};

let fixture: Setup;

function helper<T>(...args: string[]): T {
  return JSON.parse(
    execFileSync(process.execPath, [helperPath, ...args], {
      encoding: "utf8",
    }),
  ) as T;
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values: Array<string | number | boolean | null>): string {
  return values.map(csvCell).join(",");
}

function invitees(prefix: string): string {
  return JSON.stringify([
    { category: "ADULT", fullName: `${prefix} Adult`, label: "Primary" },
    { category: "CHILD", fullName: `${prefix} Child`, label: null },
  ]);
}

function csvFixture(setup: Setup): Buffer {
  const header = [
    "displayName",
    "greetingName",
    "allowPlusOne",
    "maxAdditionalChildren",
    "rsvpDeadlineLocal",
    "notes",
    "invitees",
    `event:${setup.ceremonySlug}`,
    `event:${setup.receptionSlug}`,
    `event:${setup.inactiveSlug}`,
  ];
  return Buffer.from(
    [
      csvRow(header),
      csvRow([
        `Phase9E ${setup.runId} CSV Household`,
        "CSV Guests",
        true,
        2,
        "2027-01-16 18:30",
        "CSV synthetic note",
        invitees(`Phase9E ${setup.runId} CSV`),
        true,
        true,
        null,
      ]),
      csvRow([
        setup.duplicateName,
        "Duplicate Guests",
        false,
        0,
        null,
        "Duplicate warning row",
        invitees(`Phase9E ${setup.runId} Duplicate`),
        true,
        false,
        null,
      ]),
      csvRow([
        `Phase9E ${setup.runId} Inactive Event`,
        "Inactive Guests",
        false,
        0,
        null,
        "Should remain preview-only",
        invitees(`Phase9E ${setup.runId} Inactive`),
        false,
        false,
        true,
      ]),
    ].join("\r\n") + "\r\n",
    "utf8",
  );
}

function delta(after: Snapshot, before: Snapshot, key: string): number {
  return after.counts[key]! - before.counts[key]!;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(fixture.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
}

async function openImport(page: Page) {
  await login(page);
  await page.goto("/invitations/import");
  await expect(
    page.getByRole("heading", { name: "Import CSV/XLSX", exact: true }),
  ).toBeVisible();
}

async function confirmImport(page: Page) {
  await page.getByRole("button", { name: "Review import" }).click();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
}

test.describe.serial("real guest import integration", () => {
  test.beforeAll(() => {
    fixture = helper<Setup>("setup", runId);
  });

  test.afterAll(() => {
    if (fixture) helper<{ cleaned: true }>("cleanup", fixture.runId);
  });

  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (error) => {
      throw error;
    });
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().startsWith("Failed to load resource:")
      ) {
        throw new Error(`Unexpected browser console error: ${message.text()}`);
      }
    });
  });

  test("CSV import uses real API, PostgreSQL, exact recovery, and commit body integrity", async ({
    page,
  }) => {
    await page.goto("/invitations/import");
    await expect(page).toHaveURL(/\/login(?:\?session=ended)?$/);

    await openImport(page);
    const databasesBefore = await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download CSV template" }).click();
    const template = await download;
    const templateText = await readFile((await template.path())!, "utf8");
    expect(templateText.trim().split(/\r?\n/)).toHaveLength(1);
    expect(templateText).toContain(`event:${fixture.ceremonySlug}`);
    expect(templateText).toContain(`event:${fixture.receptionSlug}`);
    expect(templateText).not.toContain(`event:${fixture.inactiveSlug}`);

    const beforeValidate = helper<Snapshot>("snapshot", fixture.runId);
    const validateRequest = page.waitForRequest((request) =>
      request.url().endsWith("/api/admin/imports/guest/validate"),
    );
    const validateResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/imports/guest/validate"),
    );
    await page.locator('input[type="file"]').setInputFiles({
      buffer: csvFixture(fixture),
      mimeType: "text/csv",
      name: "phase9e-live.csv",
    });
    await page
      .getByRole("button", { name: "Validate file", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Household preview" }),
    ).toBeVisible();
    const uploadRequest = await validateRequest;
    const uploadHeaders = await uploadRequest.allHeaders();
    expect(uploadRequest.method()).toBe("POST");
    expect(uploadHeaders["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(uploadHeaders["x-csrf-token"]).toBeTruthy();
    expect(uploadHeaders.cookie).toContain("admin_session=");
    expect((await validateResponse).status()).toBe(201);

    await expect(page.getByText("RSVP deadline (UTC)").first()).toBeVisible();
    await expect(page.getByText("2027-01-16T11:30:00.000Z")).toBeVisible();
    await expect(
      page.getByText(`${fixture.ceremonySlug}, ${fixture.receptionSlug}`),
    ).toBeVisible();
    await expect(page.getByText("POSSIBLE_DUPLICATE")).toBeVisible();
    await expect(page.getByText("INACTIVE_EVENT")).toBeVisible();
    await expect(
      page.getByLabel("Select row 4", { exact: true }),
    ).toBeDisabled();
    await page.getByLabel("I acknowledge warnings for row 3").check();
    await page.getByLabel("Select row 3", { exact: true }).check();

    const afterValidate = helper<Snapshot>("snapshot", fixture.runId);
    expect(delta(afterValidate, beforeValidate, "guestImportPreviews")).toBe(1);
    expect(delta(afterValidate, beforeValidate, "guestImportBatches")).toBe(0);
    expect(delta(afterValidate, beforeValidate, "invitations")).toBe(0);
    expect(delta(afterValidate, beforeValidate, "invitees")).toBe(0);
    expect(delta(afterValidate, beforeValidate, "rsvps")).toBe(0);

    const commitBodies: string[] = [];
    let realReceipt: unknown = null;
    await page.route(commitPath, async (route) => {
      commitBodies.push(route.request().postData() ?? "");
      if (commitBodies.length === 1) {
        const realResponse = await route.fetch();
        expect(realResponse.status()).toBe(200);
        realReceipt = await realResponse.json();
        await route.fulfill({
          body: "{}",
          contentType: "application/json",
          status: 500,
        });
        return;
      }
      await route.continue();
    });

    await confirmImport(page);
    await expect(
      page.getByRole("heading", { name: "Import outcome not confirmed" }),
    ).toBeVisible();
    expect(commitBodies).toHaveLength(1);
    expect(JSON.parse(commitBodies[0]!)).toEqual({
      acknowledgedWarningRowNumbers: [3],
      includeRowNumbers: [2, 3],
      previewId: expect.stringMatching(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      ),
    });
    expect(Object.keys(JSON.parse(commitBodies[0]!) as object).sort()).toEqual([
      "acknowledgedWarningRowNumbers",
      "includeRowNumbers",
      "previewId",
    ]);

    const afterSuppressedCommit = helper<Snapshot>("snapshot", fixture.runId);
    expect(
      delta(afterSuppressedCommit, afterValidate, "guestImportBatches"),
    ).toBe(1);
    expect(delta(afterSuppressedCommit, afterValidate, "invitations")).toBe(2);
    expect(delta(afterSuppressedCommit, afterValidate, "invitees")).toBe(4);
    expect(
      delta(afterSuppressedCommit, afterValidate, "invitationEvents"),
    ).toBe(3);
    expect(delta(afterSuppressedCommit, afterValidate, "rsvps")).toBe(0);
    expect(afterSuppressedCommit.imports.at(-1)).toMatchObject({
      createdInvitationCount: 2,
      createdInviteeCount: 4,
      hasCommitFingerprint: true,
      previewStatus: "COMMITTED",
      sourceFormat: "CSV",
      warningCount: 1,
    });

    await page.getByRole("button", { name: "Check import result" }).click();
    await expect(
      page.getByRole("heading", { name: "Import complete" }),
    ).toBeVisible();
    expect(commitBodies).toHaveLength(2);
    expect(commitBodies[1]).toBe(commitBodies[0]);
    const afterRecovery = helper<Snapshot>("snapshot", fixture.runId);
    expect(afterRecovery.counts).toEqual(afterSuppressedCommit.counts);
    expect(afterRecovery.imports).toEqual(afterSuppressedCommit.imports);
    await expect(
      page.getByText(
        (realReceipt as { importBatch?: { id?: string } }).importBatch?.id ??
          "",
      ),
    ).toBeVisible();

    const csvHousehold = afterRecovery.scopedInvitations.find(
      (invitation) =>
        invitation.displayName === `Phase9E ${fixture.runId} CSV Household`,
    );
    expect(csvHousehold).toMatchObject({
      allowPlusOne: true,
      greetingName: "CSV Guests",
      hasPublicTokenHash: true,
      maxAdditionalChildren: 2,
      notes: "CSV synthetic note",
      rsvpCount: 0,
      rsvpDeadlineAt: "2027-01-16T11:30:00.000Z",
      status: "ACTIVE",
    });
    expect(
      csvHousehold?.invitees.map((invitee) => invitee.displayOrder),
    ).toEqual([0, 1]);
    expect(csvHousehold?.events.map((event) => event.slug)).toEqual([
      fixture.ceremonySlug,
      fixture.receptionSlug,
    ]);
    expect(
      afterRecovery.scopedInvitations.filter(
        (invitation) => invitation.displayName === fixture.duplicateName,
      ),
    ).toHaveLength(2);

    const storageText = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(storageText).not.toContain(fixture.runId);
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).map((db) => db.name),
      ),
    ).toEqual(databasesBefore);
  });

  test("XLSX import round trip reaches the same live backend contract", async ({
    page,
  }, testInfo) => {
    const xlsxPath = testInfo.outputPath("phase9e-live.xlsx");
    helper<{ outputPath: string }>("xlsx", fixture.runId, xlsxPath);
    await openImport(page);
    const before = helper<Snapshot>("snapshot", fixture.runId);
    const validateRequest = page.waitForRequest((request) =>
      request.url().endsWith("/api/admin/imports/guest/validate"),
    );
    await page.locator('input[type="file"]').setInputFiles(xlsxPath);
    await page
      .getByRole("button", { name: "Validate file", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Household preview" }),
    ).toBeVisible();
    const uploadHeaders = await (await validateRequest).allHeaders();
    expect(uploadHeaders["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    await expect(page.getByText("XLSX Guests")).toBeVisible();
    await expect(
      page.getByText(fixture.receptionSlug, { exact: true }),
    ).toBeVisible();

    const commitRequest = page.waitForRequest((request) =>
      request.url().endsWith("/api/admin/imports/guest/commit"),
    );
    await confirmImport(page);
    await expect(
      page.getByRole("heading", { name: "Import complete" }),
    ).toBeVisible();
    const commitBody = JSON.parse((await commitRequest).postData() ?? "{}");
    expect(commitBody).toEqual({
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2],
      previewId: expect.stringMatching(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      ),
    });

    const after = helper<Snapshot>("snapshot", fixture.runId);
    expect(delta(after, before, "guestImportPreviews")).toBe(1);
    expect(delta(after, before, "guestImportBatches")).toBe(1);
    expect(delta(after, before, "invitations")).toBe(1);
    expect(delta(after, before, "invitees")).toBe(1);
    expect(delta(after, before, "invitationEvents")).toBe(1);
    expect(delta(after, before, "rsvps")).toBe(0);
    const xlsxHousehold = after.scopedInvitations.find(
      (invitation) =>
        invitation.displayName === `Phase9E ${fixture.runId} XLSX Household`,
    );
    expect(xlsxHousehold).toMatchObject({
      allowPlusOne: false,
      greetingName: "XLSX Guests",
      hasPublicTokenHash: true,
      maxAdditionalChildren: 1,
      rsvpCount: 0,
      rsvpDeadlineAt: "2027-01-16T11:30:00.000Z",
      status: "ACTIVE",
    });
    expect(xlsxHousehold?.events.map((event) => event.slug)).toEqual([
      fixture.receptionSlug,
    ]);
  });
});
