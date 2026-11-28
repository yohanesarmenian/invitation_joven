import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import ExcelJS from "exceljs";
import { GuestImportService } from "./guest-import.service.js";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { configureApp } from "../app.setup.js";
import { AdminPasswordService } from "../auth/password.service.js";
import { AdminSessionTokenService } from "../auth/session-token.service.js";
import { getDatabaseUrl } from "../database/database-url.js";
import {
  GuestImportPreviewStatus,
  GuestImportSourceFormat,
  InvitationStatus,
  PrismaClient,
} from "../generated/prisma/client.js";
import { CredentialService } from "../security/credential.service.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const OWNER_EMAIL = "owner-import@example.com";
const OWNER_PASSWORD = "correct horse battery staple";
const CREDENTIAL_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const passwordService = new AdminPasswordService();
const tokenService = new AdminSessionTokenService();

type OwnerSession = Awaited<ReturnType<typeof createOwnerAndSession>>;

async function cleanDatabase() {
  await prisma.checkinRecord.deleteMany();
  await prisma.guestImportPreview.deleteMany();
  await prisma.guestImportBatch.deleteMany();
  await prisma.checkinPass.deleteMany();
  await prisma.rSVPEventSelection.deleteMany();
  await prisma.rSVPAttendee.deleteMany();
  await prisma.rSVP.deleteMany();
  await prisma.guestMessage.deleteMany();
  await prisma.invitationEvent.deleteMany();
  await prisma.invitee.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.event.deleteMany();
  await prisma.adminSession.deleteMany();
  await prisma.adminUser.deleteMany();
}

async function createOwnerAndSession(email = OWNER_EMAIL) {
  const owner = await prisma.adminUser.create({
    data: {
      email,
      passwordHash: await passwordService.hashPassword(OWNER_PASSWORD),
    },
  });
  const tokens = tokenService.generateSessionTokens();

  await prisma.adminSession.create({
    data: {
      adminUserId: owner.id,
      csrfTokenHash: tokens.csrfTokenHash,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      sessionTokenHash: tokens.sessionTokenHash,
    },
  });

  return {
    cookie: `admin_session=${tokens.sessionToken}`,
    csrfToken: tokens.csrfToken,
    owner,
  };
}

async function createEvent(input: {
  displayOrder: number;
  isActive?: boolean;
  slug: string;
}) {
  return prisma.event.create({
    data: {
      displayOrder: input.displayOrder,
      isActive: input.isActive ?? true,
      name: `Import ${input.slug}`,
      slug: input.slug,
    },
  });
}

async function createInvitation(
  displayName: string,
  status: InvitationStatus = InvitationStatus.ACTIVE,
) {
  return prisma.invitation.create({
    data: {
      archivedAt:
        status === InvitationStatus.ARCHIVED
          ? new Date("2026-10-01T01:00:00.000Z")
          : null,
      displayName,
      publicTokenHash: `hash-${randomUUID()}`,
      publicTokenVersion: 1,
      status,
    },
  });
}

function ownerHeaders(session: OwnerSession) {
  return {
    cookie: session.cookie,
    origin: ADMIN_ORIGIN,
    "x-csrf-token": session.csrfToken,
  };
}

function multipartBody(
  file: Buffer,
  filename: string,
  contentType = "text/csv",
  options: { duplicate?: boolean; fieldName?: string } = {},
) {
  const boundary = `----import-${randomUUID()}`;
  const fieldName = options.fieldName ?? "file";
  const filePart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    file,
    Buffer.from("\r\n"),
  ]);
  const duplicatePart = options.duplicate
    ? Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        file,
        Buffer.from("\r\n"),
      ])
    : Buffer.alloc(0);
  const payload = Buffer.concat([
    filePart,
    duplicatePart,
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  return {
    headers: {
      "content-length": String(payload.length),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  };
}

function csv(rows: string[]) {
  return Buffer.from(rows.join("\n"), "utf8");
}

function inviteesJson() {
  return JSON.stringify([
    { category: "ADULT", fullName: "Alex Guest", label: "Primary" },
    { category: "CHILD", fullName: "Little Guest", label: null },
  ]).replaceAll("\"", "\"\"");
}

function validCsvRow(displayName: string, eventValue = "true") {
  return `"${displayName}",Guests,true,2,2027-01-16 18:30,"Line one
Line two","${inviteesJson()}",${eventValue}`;
}

function validCsvFile(displayName = "Created Household") {
  return csv([
    "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
    validCsvRow(displayName),
  ]);
}

async function validWorkbook(options: {
  eventSlug?: string;
  eventValue?: boolean;
  extraRows?: number;
  filename?: string;
  formula?: boolean;
  hidden?: boolean;
  merge?: boolean;
  otherSheet?: boolean;
  serialDeadline?: boolean;
} = {}) {
  const workbook = new ExcelJS.Workbook();
  if (options.otherSheet) {
    workbook.addWorksheet("Ignored").addRow(["not", "the", "template"]);
  }
  const sheet = workbook.addWorksheet("Invitations", {
    state: options.hidden ? "hidden" : "visible",
  });
  sheet.addRow([
    "displayName",
    "greetingName",
    "allowPlusOne",
    "maxAdditionalChildren",
    "rsvpDeadlineLocal",
    "notes",
    "invitees",
    `event:${options.eventSlug ?? "ceremony"}`,
  ]);
  sheet.addRow([
    "Workbook Household",
    "Guests",
    true,
    1,
    options.serialDeadline ? 44927 : "2027-01-16 18:30",
    "note",
    JSON.stringify([{ category: "ADULT", fullName: "Alex Guest" }]),
    options.formula
      ? { formula: "TRUE()", result: true }
      : (options.eventValue ?? true),
  ]);
  for (let index = 0; index < (options.extraRows ?? 0); index += 1) {
    sheet.addRow([
      `Workbook Household ${index}`,
      "Guests",
      true,
      1,
      "2027-01-16 18:30",
      "note",
      JSON.stringify([{ category: "ADULT", fullName: "Alex Guest" }]),
      true,
    ]);
  }

  if (options.merge) {
    sheet.mergeCells("A2:B2");
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function upload(
  app: NestFastifyApplication,
  session: OwnerSession,
  file: Buffer,
  filename = "guests.csv",
  headers: Record<string, string> = ownerHeaders(session),
  options: Parameters<typeof multipartBody>[3] = {},
) {
  const multipart = multipartBody(file, filename, undefined, options);

  return app.getHttpAdapter().getInstance().inject({
    headers: { ...headers, ...multipart.headers },
    method: "POST",
    payload: multipart.payload,
    url: "/api/admin/imports/guest/validate",
  });
}

async function commitImport(
  app: NestFastifyApplication,
  session: OwnerSession,
  body: unknown,
  headers: Record<string, string> = ownerHeaders(session),
) {
  return app.getHttpAdapter().getInstance().inject({
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    method: "POST",
    payload: JSON.stringify(body),
    url: "/api/admin/imports/guest/commit",
  });
}

async function counts() {
  const [
    invitations,
    invitees,
    invitationEvents,
    rsvps,
    rsvpAttendees,
    rsvpEventSelections,
    guestMessages,
    checkinPasses,
    checkinRecords,
    guestImportBatches,
    guestImportPreviews,
  ] = await Promise.all([
    prisma.invitation.count(),
    prisma.invitee.count(),
    prisma.invitationEvent.count(),
    prisma.rSVP.count(),
    prisma.rSVPAttendee.count(),
    prisma.rSVPEventSelection.count(),
    prisma.guestMessage.count(),
    prisma.checkinPass.count(),
    prisma.checkinRecord.count(),
    prisma.guestImportBatch.count(),
    prisma.guestImportPreview.count(),
  ]);

  return {
    checkinPasses,
    checkinRecords,
    guestImportBatches,
    guestImportPreviews,
    guestMessages,
    invitationEvents,
    invitations,
    invitees,
    rsvpAttendees,
    rsvpEventSelections,
    rsvps,
  };
}

function twoSessionCsv() {
  return csv([
    "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony,event:reception",
    validCsvRow("Two-session household", "true,true"),
  ]);
}

async function waitForEventLock(clause: "FOR UPDATE" | "FOR SHARE") {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [activity] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND query LIKE '%FROM events%'
          AND query LIKE ${`%${clause}%`}
      ) AS waiting
    `;
    if (activity?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Expected PostgreSQL to queue the Event ${clause} lock`);
}

function manageEvent(
  app: NestFastifyApplication,
  session: OwnerSession,
  fields: { slug: string; displayOrder: number },
  existing?: { id: string; version: number },
) {
  return app.inject({
    method: existing ? "PUT" : "POST",
    url: existing
      ? `/api/admin/event-management/${existing.id}`
      : "/api/admin/event-management",
    headers: ownerHeaders(session),
    payload: {
      ...fields,
      name: "Synthetic import session",
      description: null,
      startsAt: null,
      endsAt: null,
      venueName: null,
      address: null,
      googleMapsUrl: null,
      isActive: true,
      ...(existing && { expectedVersion: existing.version }),
    },
  });
}

async function expectStaleCommit(
  app: NestFastifyApplication,
  session: OwnerSession,
  body: { previewId: string; includeRowNumbers: number[] },
) {
  const before = await counts();
  const response = await commitImport(app, session, {
    ...body,
    acknowledgedWarningRowNumbers: [],
  });
  await expectStaleResponse(body.previewId, before, response);
}

async function expectStaleResponse(
  previewId: string,
  before: Awaited<ReturnType<typeof counts>>,
  response: Awaited<ReturnType<typeof commitImport>>,
) {
  expect({
    status: response.statusCode,
    code: response.json().error?.code,
    counts: await counts(),
    preview: await prisma.guestImportPreview.findUniqueOrThrow({
      where: { id: previewId },
      select: {
        status: true,
        committedBatchId: true,
        commitFingerprint: true,
      },
    }),
  }).toEqual({
    status: 409,
    code: "IMPORT_PREVIEW_STALE",
    counts: before,
    preview: {
      status: GuestImportPreviewStatus.PENDING,
      committedBatchId: null,
      commitFingerprint: null,
    },
  });
}

describe("POST /api/admin/imports/guest/validate", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.ADMIN_ORIGIN = ADMIN_ORIGIN;
    process.env.CREDENTIAL_SECRET = CREDENTIAL_SECRET;
    process.env.NODE_ENV = "test";

    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { bufferLogs: true },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(async () => {
    process.env.ADMIN_ORIGIN = ADMIN_ORIGIN;
    process.env.NODE_ENV = "test";
    await cleanDatabase();
    await createEvent({ displayOrder: 1, slug: "ceremony" });
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
    await prisma.$disconnect();
  });

  it("downloads an OWNER-only Excel template and commits individual, couple and household rows once", async () => {
    const reception = await createEvent({ displayOrder: 2, slug: "reception" });
    await createEvent({ displayOrder: 3, slug: "inactive", isActive: false });
    const session = await createOwnerAndSession();
    const server = app.getHttpAdapter().getInstance();
    const url = "/api/admin/imports/guest/template";
    expect((await server.inject({ method: "GET", url })).statusCode).toBe(401);
    const download = await server.inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-disposition"]).toContain(
      "guest-import-template.xlsx",
    );
    expect(download.headers["cache-control"]).toBe("no-store");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      download.rawPayload as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0],
    );
    expect(workbook.worksheets.map(({ name }) => name)).toEqual([
      "Instructions",
      "Invitations",
      "Guests",
      "Events",
    ]);
    const events = workbook.getWorksheet("Events")!;
    expect(events.getColumn("B").values.slice(1)).toEqual([
      "EventSlug",
      "ceremony",
      "reception",
    ]);
    const invitations = workbook.getWorksheet("Invitations")!;
    expect(invitations.getCell("H2").dataValidation.formulae).toEqual([
      "WeddingSessionChoices",
    ]);
    const guests = workbook.getWorksheet("Guests")!;
    const choices = [
      events.getCell("F2").value,
      events.getCell("F3").value,
      events.getCell("F4").value,
    ];
    invitations.getRow(2).values = [
      "I01",
      "Synthetic Individual",
      null,
      "No",
      0,
      null,
      null,
      choices[0],
    ];
    invitations.getRow(4).values = [
      "C01",
      "Synthetic Couple",
      null,
      "No",
      0,
      null,
      null,
      choices[1],
    ];
    invitations.getRow(6).values = [
      "F01",
      "Synthetic Household",
      "Synthetic family",
      "Yes",
      2,
      "2027-01-16 18:30",
      null,
      choices[2],
    ];
    guests.addRows([
      ["i01", "Individual Adult", "Adult"],
      ["c01", "Couple Adult 1", "Adult"],
      ["C01", "Couple Adult 2", "Adult"],
      ["F01", "Household Adult", "Adult", "Parent"],
      ["F01", "Household Child", "Child"],
      ["f01", "Household Adult 2", "Adult"],
    ]);
    const before = await counts();
    const response = await upload(
      app,
      session,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "guests.xlsx",
    );
    expect(response.statusCode, response.body).toBe(201);
    const preview = response.json();
    expect(preview.templateVersion).toBe(2);
    expect(
      preview.rows.map((row: { rowNumber: number }) => row.rowNumber),
    ).toEqual([2, 4, 6]);
    expect(preview.rows[2].parsed).toMatchObject({
      eligibleEventNames: ["Import ceremony", "Import reception"],
      eligibleEventSlugs: ["ceremony", "reception"],
      rsvpDeadlineAt: "2027-01-16T11:30:00.000Z",
      invitees: [
        { fullName: "Household Adult", category: "ADULT", label: "Parent" },
        { fullName: "Household Child", category: "CHILD", label: null },
        { fullName: "Household Adult 2", category: "ADULT", label: null },
      ],
    });
    expect(await counts()).toEqual({
      ...before,
      guestImportPreviews: before.guestImportPreviews + 1,
    });
    const body = {
      previewId: preview.previewId,
      includeRowNumbers: [2, 4, 6],
      acknowledgedWarningRowNumbers: [],
    };

    await prisma.event.update({
      where: { id: reception.id },
      data: { venueName: "Changed venue" },
    });
    await expectStaleCommit(app, session, body);
    const refreshed = await upload(
      app,
      session,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "guests.xlsx",
    );
    expect(refreshed.statusCode).toBe(400);
    expect(refreshed.json().error.code).toBe("IMPORT_WORKBOOK_INVALID");
    await prisma.event.update({
      where: { id: reception.id },
      data: { venueName: reception.venueName },
    });

    const commit = await commitImport(app, session, body);
    expect(commit.statusCode).toBe(200);
    expect(commit.json().importBatch).toMatchObject({
      createdInvitationCount: 3,
      createdInviteeCount: 6,
    });
    expect((await commitImport(app, session, body)).json()).toEqual(
      commit.json(),
    );
    expect(await counts()).toEqual({
      ...before,
      guestImportPreviews: before.guestImportPreviews + 1,
      guestImportBatches: before.guestImportBatches + 1,
      invitations: before.invitations + 3,
      invitees: before.invitees + 6,
      invitationEvents: before.invitationEvents + 4,
    });
  });

  it("prefills a single active session and pinpoints duplicate references, missing guests, invalid category and text dates", async () => {
    const session = await createOwnerAndSession();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await app
        .get(GuestImportService)
        .downloadTemplate()) as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0],
    );
    const invitations = workbook.getWorksheet("Invitations")!;
    const guests = workbook.getWorksheet("Guests")!;
    const sessionChoice = invitations.getCell("H501").value;
    expect(sessionChoice).toBe("A • Import ceremony");
    invitations.getRow(2).values = [
      "D1",
      "Duplicate one",
      null,
      null,
      null,
      null,
      null,
      sessionChoice,
    ];
    invitations.getRow(3).values = [
      "d1",
      "Duplicate two",
      null,
      null,
      null,
      null,
      null,
      sessionChoice,
    ];
    invitations.getRow(4).values = [
      "G1",
      "Invalid guest",
      null,
      null,
      null,
      46000,
      null,
      sessionChoice,
    ];
    invitations.getRow(5).values = ["G2", "Missing session"];
    invitations.getRow(6).values = [
      "G3",
      "Missing named guests",
      null,
      null,
      null,
      null,
      null,
      sessionChoice,
    ];
    guests.addRows([
      ["D1", "Ambiguous Adult", "Adult"],
      ["G1", "Typo Category", "Other"],
      ["G2", "Named Adult", "Adult"],
    ]);
    const uploadWorkbook = async () =>
      upload(
        app,
        session,
        Buffer.from(await workbook.xlsx.writeBuffer()),
        "guests.xlsx",
      );
    const response = await uploadWorkbook();
    expect(response.statusCode, response.body).toBe(201);
    const errors = response.json().rows;
    expect(errors.map((row: { status: string }) => row.status)).toEqual(
      Array(5).fill("ERROR"),
    );
    expect(errors[0].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: "HouseholdRef",
          message: expect.stringContaining("Duplicate reference"),
        }),
      ]),
    );
    expect(errors[1].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: "HouseholdRef",
          message: expect.stringContaining("Duplicate reference"),
        }),
      ]),
    );
    expect(errors[2].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: "Category",
          message: expect.stringContaining("Guests row 3"),
        }),
        expect.objectContaining({
          column: "RSVPDeadlineWIB",
          code: "INVALID_DATE",
        }),
      ]),
    );
    expect(errors[3].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: "SessionSelection" }),
      ]),
    );
    expect(errors[4].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("matching named guest"),
        }),
      ]),
    );

    guests.addRow(["typo", "Orphaned Adult", "Adult"]);
    const orphan = await uploadWorkbook();
    expect(orphan.statusCode).toBe(400);
    expect(orphan.json().error).toMatchObject({
      code: "IMPORT_WORKBOOK_INVALID",
      message: expect.stringContaining("Guests row 5, HouseholdRef"),
    });
    guests.getRow(5).values = [];
    guests.getCell("B2").value = { formula: "1+1", result: 2 };
    const formula = await uploadWorkbook();
    expect(formula.statusCode).toBe(400);
    expect(formula.json().error.message).toContain("Guests cell B2");
  });

  it("uses named Yes/No columns when more than two sessions are active", async () => {
    await createEvent({ displayOrder: 2, slug: "reception" });
    await createEvent({ displayOrder: 3, slug: "third-session" });
    const session = await createOwnerAndSession();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await app
        .get(GuestImportService)
        .downloadTemplate()) as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0],
    );
    const invitations = workbook.getWorksheet("Invitations")!;
    expect(invitations.getCell("H1").value).toBe("[A] Import ceremony");
    expect(invitations.getCell("J1").value).toBe("[C] Import third-session");
    invitations.addRows([
      ["V01", "Choose two", null, null, null, null, null, "Yes", "No", "Yes"],
      [
        "V02",
        "Choose three",
        null,
        null,
        null,
        null,
        null,
        "Yes",
        "Yes",
        "Yes",
      ],
    ]);
    workbook.getWorksheet("Guests")!.addRows([
      ["V01", "Adult one", "Adult"],
      ["V02", "Adult two", "Adult"],
    ]);
    const response = await upload(
      app,
      session,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "guests.xlsx",
    );
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().rows).toMatchObject([
      {
        status: "VALID",
        parsed: { eligibleEventSlugs: ["ceremony", "third-session"] },
      },
      {
        status: "ERROR",
        errors: [expect.objectContaining({ field: "eventIds" })],
      },
    ]);

    workbook.getWorksheet("Instructions")!.getCell("B2").value = 3;
    const unknownVersion = await upload(
      app,
      session,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "guests.xlsx",
    );
    expect(unknownVersion.statusCode).toBe(400);
  });


  it("counts only real invitation rows after a single-session Excel row insertion", async () => {
    const session = await createOwnerAndSession();
    const workbook = new ExcelJS.Workbook();
    const template = await app.get(GuestImportService).downloadTemplate();
    await workbook.xlsx.load(
      template as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const invitations = workbook.getWorksheet("Invitations")!;
    const choice = invitations.getCell("H2").value;
    invitations.spliceRows(2, 0, ["N01", "Inserted Household", null, null, null, null, null, choice]);
    expect(invitations.getCell("H502").value).toBe(choice);
    workbook.getWorksheet("Guests")!.addRow(["N01", "Named Guest", "Adult"]);
    const preview = await upload(app, session, Buffer.from(await workbook.xlsx.writeBuffer()), "guests.xlsx");
    expect(preview.statusCode, preview.body).toBe(201);
    expect(preview.json().summary).toMatchObject({ totalRows: 1, validRows: 1 });
  });

  it("binds downloaded choices to exact event identity and distinguishes duplicate session names", async () => {
    const session = await createOwnerAndSession();
    const reception = await createEvent({ displayOrder: 2, slug: "reception" });
    const startsAt = new Date("2027-01-16T11:00:01Z");
    const original = await prisma.event.update({
      where: { id: reception.id },
      data: { name: "Import ceremony", startsAt },
    });
    const workbook = new ExcelJS.Workbook();
    const template = await app.get(GuestImportService).downloadTemplate();
    await workbook.xlsx.load(
      template as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const choice = workbook.getWorksheet("Events")!.getCell("F4").value;
    workbook.getWorksheet("Invitations")!.addRow(["N01", "Two distinct sessions", null, null, null, null, null, choice]);
    workbook.getWorksheet("Guests")!.addRow(["N01", "Named Guest", "Adult"]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());
    const initial = await upload(app, session, file, "guests.xlsx");
    expect(initial.statusCode, initial.body).toBe(201);
    expect(initial.json().rows[0].parsed.eligibleEventNames).toEqual([
      "Import ceremony (ceremony)",
      "Import ceremony (reception)",
    ]);

    await prisma.event.update({
      where: { id: reception.id },
      data: { startsAt: new Date("2027-01-16T11:00:02Z") },
    });
    const changedTime = await upload(app, session, file, "guests.xlsx");
    expect(changedTime.json().error.code).toBe("IMPORT_WORKBOOK_INVALID");

    await prisma.event.update({
      where: { id: reception.id },
      data: { slug: "old-reception", isActive: false },
    });
    await prisma.event.create({
      data: { name: original.name, slug: original.slug, startsAt, displayOrder: 3, isActive: true },
    });
    const replaced = await upload(app, session, file, "guests.xlsx");
    expect(replaced.statusCode).toBe(400);
    expect(replaced.json().error.code).toBe("IMPORT_WORKBOOK_INVALID");
  });

  it("enforces decoded text and workbook dimensions before storing a preview", async () => {
    const session = await createOwnerAndSession();
    const workbook = new ExcelJS.Workbook();
    const template = await app.get(GuestImportService).downloadTemplate();
    await workbook.xlsx.load(
      template as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const invitations = workbook.getWorksheet("Invitations")!;
    invitations.getCell("A2").value = "N01";
    invitations.getCell("B2").value = "Text limit check";
    const guests = workbook.getWorksheet("Guests")!;
    guests.addRow(["N01", "x".repeat(2_001), "Adult"]);
    const file = async () => Buffer.from(await workbook.xlsx.writeBuffer());
    const before = await counts();
    const oversizedCell = await upload(app, session, await file(), "guests.xlsx");
    expect(oversizedCell.statusCode).toBe(400);
    expect(oversizedCell.json().error.message).toContain("Guests cell B2");

    for (let row = 2; row < 1_070; row++) {
      guests.getRow(row).values = ["N01", "x".repeat(1_900), "Adult"];
    }
    const oversizedText = await upload(app, session, await file(), "guests.xlsx");
    expect(oversizedText.statusCode).toBe(400);
    expect(oversizedText.json().error.message).toContain("workbook text limit");

    const other = workbook.addWorksheet("Extra");
    other.getCell(1, 257).value = "Outside the supported workbook width";
    const oversizedColumn = await upload(app, session, await file(), "guests.xlsx");
    expect(oversizedColumn.statusCode).toBe(400);
    expect(oversizedColumn.json().error.code).toBe("VALIDATION_ERROR");
    expect(await counts()).toEqual(before);
  });


  it("requires OWNER auth, Origin, and CSRF for multipart upload", async () => {
    const session = await createOwnerAndSession();
    const body = multipartBody(validCsvFile(), "guests.csv");
    const server = app.getHttpAdapter().getInstance();
    const unauthenticated = await server.inject({
      headers: body.headers,
      method: "POST",
      payload: body.payload,
      url: "/api/admin/imports/guest/validate",
    });
    const missingOrigin = await upload(app, session, validCsvFile(), "guests.csv", {
      cookie: session.cookie,
      "x-csrf-token": session.csrfToken,
    });
    const missingCsrf = await upload(app, session, validCsvFile(), "guests.csv", {
      cookie: session.cookie,
      origin: ADMIN_ORIGIN,
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingCsrf.statusCode).toBe(403);
  });

  it.each(["csv", "xlsx"])(
    "checks session limits per %s row and commits only eligible selections",
    async (format) => {
      const session = await createOwnerAndSession();
      await createEvent({ displayOrder: 2, slug: "reception" });
      await createEvent({ displayOrder: 3, slug: "third-session" });
      const headers =
        "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony,event:reception,event:third-session";
      const matrix = [
        [true, false, false],
        [false, true, true],
        [false, false, false],
        [true, true, true],
      ];
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Invitations");
      sheet.addRow(headers.split(","));
      for (const [index, events] of matrix.entries()) {
        sheet.addRow([
          `Session limit ${index}`,
          "",
          false,
          0,
          "",
          "",
          JSON.stringify([{ fullName: "Named Guest", category: "ADULT" }]),
          ...events,
        ]);
      }
      const file =
        format === "xlsx"
          ? Buffer.from(await workbook.xlsx.writeBuffer())
          : csv([
              headers,
              ...matrix.map((events, index) =>
                validCsvRow(`Session limit ${index}`, events.join(",")),
              ),
            ]);
      const preview = await upload(
        app,
        session,
        file,
        `session-limits.${format}`,
      );
      expect(preview.statusCode).toBe(201);
      const body = preview.json();
      expect(body.summary).toMatchObject({
        totalRows: 4,
        validRows: 2,
        errorRows: 2,
      });
      expect(body.rows[0].parsed.eligibleEventSlugs).toEqual(["ceremony"]);
      expect(body.rows[1].parsed.eligibleEventSlugs).toEqual([
        "reception",
        "third-session",
      ]);
      for (const [index, rowNumber] of [
        [2, 4],
        [3, 5],
      ] as const) {
        expect(body.rows[index]).toMatchObject({
          rowNumber,
          status: "ERROR",
          errors: [
            {
              rowNumber,
              field: "eventIds",
              code: "INVALID_VALUE",
              message: expect.stringContaining(
                "Set 1 or 2 active event columns",
              ),
            },
          ],
        });
        expect(body.rows[index].parsed).toBeUndefined();
      }
      const command = {
        previewId: body.previewId,
        acknowledgedWarningRowNumbers: [],
      };
      const before = await counts();
      expect(
        (
          await commitImport(app, session, {
            ...command,
            includeRowNumbers: [2, 5],
          })
        ).statusCode,
      ).toBe(400);
      expect(await counts()).toEqual(before);
      const committed = await commitImport(app, session, {
        ...command,
        includeRowNumbers: [2, 3],
      });
      expect(committed.statusCode).toBe(200);
      expect(await counts()).toMatchObject({
        invitations: before.invitations + 2,
        invitationEvents: before.invitationEvents + 3,
        rsvps: before.rsvps,
      });
    },
  );

  it("rejects an old pending three-session preview atomically and reads a prior committed receipt", async () => {
    const session = await createOwnerAndSession();
    const reception = await createEvent({ displayOrder: 2, slug: "reception" });
    const third = await createEvent({ displayOrder: 3, slug: "third-session" });
    const ceremony = await prisma.event.findUniqueOrThrow({
      where: { slug: "ceremony" },
    });
    const legacyRow = {
      rowNumber: 3,
      status: "VALID",
      eventSlugs: [ceremony.slug, reception.slug, third.slug],
      errors: [],
      warnings: [],
      input: {
        eventIds: [ceremony.id, reception.id, third.id],
        displayName: "Legacy preview family",
        allowPlusOne: false,
        greetingName: null,
        maxAdditionalChildren: 0,
        rsvpDeadlineAt: null,
        notes: null,
        invitees: [{ fullName: "Named Guest", category: "ADULT", label: null }],
      },
    };

    const pending = await upload(
      app,
      session,
      validCsvFile("New preview family"),
    );
    const pendingId: string = pending.json().previewId;
    const patchRows = async (previewId: string, replace = false) => {
      const { normalizedRows } =
        await prisma.guestImportPreview.findUniqueOrThrow({
          where: { id: previewId },
        });
      if (!Array.isArray(normalizedRows))
        throw new Error("Expected persisted preview rows");
      await prisma.guestImportPreview.update({
        where: { id: previewId },
        data: {
          normalizedRows: replace
            ? [{ ...legacyRow, rowNumber: 2 }]
            : [...normalizedRows, legacyRow],
        },
      });
    };
    await patchRows(pendingId);
    const before = await counts();
    await expectStaleCommit(app, session, {
      previewId: pendingId,
      includeRowNumbers: [2, 3],
    });
    const validSubset = await commitImport(app, session, {
      previewId: pendingId,
      includeRowNumbers: [2],
      acknowledgedWarningRowNumbers: [],
    });
    expect(validSubset.statusCode).toBe(200);
    expect(await counts()).toMatchObject({
      invitations: before.invitations + 1,
    });

    const committed = await upload(
      app,
      session,
      validCsvFile("Already imported family"),
    );
    const command = {
      previewId: committed.json().previewId,
      includeRowNumbers: [2],
      acknowledgedWarningRowNumbers: [],
    };
    const receipt = await commitImport(app, session, command);
    expect(receipt.statusCode).toBe(200);
    await patchRows(command.previewId, true);
    const after = await counts();
    const replay = await commitImport(app, session, command);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(receipt.json());
    expect(await counts()).toEqual(after);
  });

  it("persists a valid CSV preview without creating business data", async () => {
    const session = await createOwnerAndSession();
    const before = await counts();
    const startedAt = Date.now();
    const response = await upload(app, session, validCsvFile(), "C:\\fake\\guests.csv");
    const finishedAt = Date.now();
    const after = await counts();
    const preview = await prisma.guestImportPreview.findUniqueOrThrow({
      where: { id: response.json().previewId },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().summary).toEqual({
      errorRows: 0,
      totalRows: 1,
      validRows: 1,
      warningRows: 0,
    });
    expect(after).toEqual({ ...before, guestImportPreviews: before.guestImportPreviews + 1 });
    expect(preview.createdByAdminUserId).toBe(session.owner.id);
    expect(preview.sanitizedSourceFilename).toBe("guests.csv");
    expect(preview.sourceFormat).toBe(GuestImportSourceFormat.CSV);
    expect(preview.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.expiresAt.getTime()).toBeGreaterThanOrEqual(
      startedAt + 29 * 60 * 1000,
    );
    expect(preview.expiresAt.getTime()).toBeLessThanOrEqual(
      finishedAt + 31 * 60 * 1000,
    );
    expect(JSON.stringify(preview.normalizedRows)).not.toContain(
      validCsvFile().toString("utf8"),
    );
  });

  it("returns authoritative normalized parsed household data for preview rows", async () => {
    const session = await createOwnerAndSession();
    await createEvent({ displayOrder: 2, slug: "reception" });
    await createEvent({ displayOrder: 3, slug: "afterparty" });
    const before = await counts();
    const source = csv([
      "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony,event:reception,event:afterparty",
      "\"  Canonical Household  \",\"  Dear Guests  \",TRUE,3,2027-01-16 18:30,\"private admin note\",\"[{\"\"fullName\"\":\"\"  Adult One  \"\",\"\"category\"\":\"\"adult\"\",\"\"label\"\":\"\" Host \"\"},{\"\"fullName\"\":\"\"Child One\"\",\"\"category\"\":\"\"CHILD\"\",\"\"label\"\":null}]\",true,FALSE,",
    ]);
    const response = await upload(app, session, source);
    const after = await counts();
    const parsed = response.json().rows[0].parsed;
    const preview = await prisma.guestImportPreview.findUniqueOrThrow({
      where: { id: response.json().previewId },
    });

    expect(response.statusCode).toBe(201);
    expect(parsed).toEqual({
      allowPlusOne: true,
      displayName: "Canonical Household",
      eligibleEventSlugs: ["ceremony"],
      greetingName: "Dear Guests",
      invitees: [
        { category: "ADULT", fullName: "Adult One", label: "Host" },
        { category: "CHILD", fullName: "Child One", label: null },
      ],
      maxAdditionalChildren: 3,
      rsvpDeadlineAt: "2027-01-16T11:30:00.000Z",
      rsvpDeadlineLocal: "2027-01-16 18:30",
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "allowPlusOne",
      "displayName",
      "eligibleEventSlugs",
      "greetingName",
      "invitees",
      "maxAdditionalChildren",
      "rsvpDeadlineAt",
      "rsvpDeadlineLocal",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("private admin note");
    expect(JSON.stringify(parsed)).not.toContain("id");
    expect(JSON.stringify(parsed)).not.toContain("invitationId");
    expect(JSON.stringify(parsed)).not.toContain("displayOrder");
    expect(JSON.stringify(parsed)).not.toContain("createdAt");
    expect(JSON.stringify(parsed)).not.toContain("updatedAt");
    expect(after).toEqual({
      ...before,
      guestImportPreviews: before.guestImportPreviews + 1,
    });
    expect(
      (preview.normalizedRows as Array<{ parsed: unknown }>)[0]?.parsed,
    ).toEqual(parsed);
  });

  it("returns deterministic VALID, VALID_WITH_WARNINGS, and ERROR rows", async () => {
    const session = await createOwnerAndSession();
    await createInvitation("Duplicate Household");
    await createEvent({ displayOrder: 2, isActive: false, slug: "afterparty" });
    const source = csv([
      "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony,event:afterparty",
      validCsvRow("Unique Household", "true") + ",false",
      validCsvRow(" duplicate   household ", "true") + ",false",
      validCsvRow("Broken Household", "true") + ",true",
    ]);
    const response = await upload(app, session, source);
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.summary).toEqual({
      errorRows: 1,
      totalRows: 3,
      validRows: 2,
      warningRows: 1,
    });
    expect(body.rows.map((row: { status: string }) => row.status)).toEqual([
      "VALID",
      "VALID_WITH_WARNINGS",
      "ERROR",
    ]);
    expect(body.rows[1].warnings[0].code).toBe("POSSIBLE_DUPLICATE");
    expect(body.rows[1].parsed).toMatchObject({
      displayName: "duplicate   household",
      invitees: expect.arrayContaining([
        expect.objectContaining({ fullName: "Alex Guest" }),
      ]),
    });
    expect(body.rows[2].parsed).toBeUndefined();
    expect(body.rows[2].errors.map((error: { code: string }) => error.code)).toEqual([
      "INACTIVE_EVENT",
    ]);
  });

  it.each([
    ["missing file", Buffer.alloc(0), "guests.csv", { fieldName: "other" }],
    ["multiple files", validCsvFile(), "guests.csv", { duplicate: true }],
    ["unsupported xls", validCsvFile(), "guests.xls", {}],
    ["invalid utf8", Buffer.from([0xff, 0xfe]), "guests.csv", {}],
    ["malformed quote", csv(["displayName", "\"unterminated"]), "guests.csv", {}],
    [
      "wrong delimiter",
      csv([
        "displayName;greetingName;allowPlusOne;maxAdditionalChildren;rsvpDeadlineLocal;notes;invitees;event:ceremony",
        "A;B;true;0;;note;[];true",
      ]),
      "guests.csv",
      {},
    ],
    [
      "wrong header",
      csv(["displayName,greetingName,allowPlusOne", "A,B,true"]),
      "guests.csv",
      {},
    ],
    [
      "duplicate header",
      csv([
        "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,invitees",
        "A,B,true,0,,note,[],[]",
      ]),
      "guests.csv",
      {},
    ],
    [
      "too many rows",
      csv([
        "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
        ...Array.from({ length: 501 }, (_value, index) =>
          validCsvRow(`Household ${index}`),
        ),
      ]),
      "guests.csv",
      {},
    ],
    ["oversized", Buffer.alloc(5 * 1024 * 1024 + 1, "a"), "guests.csv", {}],
  ])("rejects file-level CSV/template failure: %s", async (_name, file, filename, options) => {
    const session = await createOwnerAndSession();
    const response = await upload(app, session, file, filename, ownerHeaders(session), options);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation error",
      },
    });
  });

  it("normalizes CSV BOM, CRLF, quoted commas, escaped quotes, multiline cells, and blank rows", async () => {
    const session = await createOwnerAndSession();
    const source = Buffer.from(
      "\uFEFFdisplayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony\r\n\r\n" +
        "\"Comma, Quote \"\" Household\",Guests,TRUE,0,,\"Line one\r\nLine two\",\"" +
        inviteesJson() +
        "\",true\r\n",
      "utf8",
    );
    const response = await upload(app, session, source);

    expect(response.statusCode).toBe(201);
    expect(response.json().rows).toMatchObject([
      {
        parsed: { displayName: "Comma, Quote \" Household" },
        rowNumber: 3,
        status: "VALID",
      },
    ]);
  });

  it.each([
    ["invalid boolean", validCsvRow("Bad", "yes"), "INVALID_VALUE"],
    [
      "negative integer",
      "\"Bad\",Guests,true,-1,,note,\"" + inviteesJson() + "\",true",
      "INVALID_VALUE",
    ],
    [
      "fractional integer",
      "\"Bad\",Guests,true,1.5,,note,\"" + inviteesJson() + "\",true",
      "INVALID_VALUE",
    ],
    [
      "impossible date",
      "\"Bad\",Guests,true,0,2027-02-30 10:00,,\"" + inviteesJson() + "\",true",
      "INVALID_DATE",
    ],
    [
      "wrong date format",
      "\"Bad\",Guests,true,0,01/16/2027,,\"" + inviteesJson() + "\",true",
      "INVALID_DATE",
    ],
    [
      "invalid invitee JSON",
      "\"Bad\",Guests,true,0,,,not-json,true",
      "INVALID_JSON",
    ],
    [
      "empty invitees",
      "\"Bad\",Guests,true,0,,note,[],true",
      "INVALID_INVITEE",
    ],
    [
      "extra invitee field",
      "\"Bad\",Guests,true,0,,note,\"[{\"\"fullName\"\":\"\"A\"\",\"\"category\"\":\"\"ADULT\"\",\"\"id\"\":\"\"x\"\"}]\",true",
      "INVALID_INVITEE",
    ],
    [
      "invalid category",
      "\"Bad\",Guests,true,0,,note,\"[{\"\"fullName\"\":\"\"A\"\",\"\"category\"\":\"\"COUSIN\"\"}]\",true",
      "INVALID_INVITEE",
    ],
  ])("returns row error for %s", async (_name, dataRow, code) => {
    const session = await createOwnerAndSession();
    const source = csv([
      "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
      dataRow,
    ]);
    const response = await upload(app, session, source);

    expect(response.statusCode).toBe(201);
    expect(response.json().rows[0].status).toBe("ERROR");
    expect(response.json().rows[0].errors).toContainEqual(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    ["valid workbook", () => validWorkbook()],
    ["other sheet ignored", () => validWorkbook({ otherSheet: true })],
  ])("accepts XLSX workbook: %s", async (_name, buildFile) => {
    const session = await createOwnerAndSession();
    const response = await upload(
      app,
      session,
      await buildFile(),
      "guests.xlsx",
      ownerHeaders(session),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().summary.validRows).toBe(1);
  });

  it.each([
    ["missing target sheet", async () => Buffer.from(await new ExcelJS.Workbook().xlsx.writeBuffer()), "guests.xlsx"],
    ["hidden sheet", () => validWorkbook({ hidden: true }), "guests.xlsx"],
    ["formula", () => validWorkbook({ formula: true }), "guests.xlsx"],
    ["numeric deadline", () => validWorkbook({ serialDeadline: true }), "guests.xlsx"],
    ["merged cell", () => validWorkbook({ merge: true }), "guests.xlsx"],
    ["too many data rows", () => validWorkbook({ extraRows: 500 }), "guests.xlsx"],
    ["unsupported xlsm", () => validWorkbook(), "guests.xlsm"],
    ["unsupported xlsb", () => validWorkbook(), "guests.xlsb"],
    ["renamed non-xlsx binary", async () => Buffer.from("PKnot-a-workbook"), "guests.xlsx"],
  ])("rejects XLSX failure: %s", async (_name, buildFile, filename) => {
    const session = await createOwnerAndSession();
    const response = await upload(
      app,
      session,
      await buildFile(),
      filename,
      ownerHeaders(session),
    );

    expect(response.statusCode).toBe(400);
  });

  it.each([
    ["unknown Event", () => validWorkbook({ eventSlug: "unknown" }), "UNKNOWN_EVENT"],
    [
      "inactive Event",
      async () => {
        await createEvent({ displayOrder: 2, isActive: false, slug: "afterparty" });
        return validWorkbook({ eventSlug: "afterparty" });
      },
      "INACTIVE_EVENT",
    ],
  ])("returns XLSX row error for %s", async (_name, buildFile, code) => {
    const session = await createOwnerAndSession();
    const response = await upload(
      app,
      session,
      await buildFile(),
      "guests.xlsx",
      ownerHeaders(session),
    );

    expect(response.statusCode).toBe(201);
    expect(response.json().rows[0].status).toBe("ERROR");
    expect(response.json().rows[0].errors).toContainEqual(
      expect.objectContaining({ code }),
    );
  });

  it("warns on active, archived, and same-preview possible duplicates using bounded normalization", async () => {
    const session = await createOwnerAndSession();
    await createInvitation("Acme  Family");
    await createInvitation("Archived Household", InvitationStatus.ARCHIVED);
    const source = csv([
      "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
      validCsvRow("  acme family  "),
      validCsvRow("archived household"),
      validCsvRow("ＡＣＭＥ Family"),
      validCsvRow("Accent É Family"),
      validCsvRow("Accent E Family"),
    ]);
    const response = await upload(app, session, source);
    const warnings = response
      .json()
      .rows.map((row: { warnings: unknown[] }) => row.warnings.length);

    expect(response.statusCode).toBe(201);
    expect(warnings).toEqual([1, 1, 1, 0, 0]);
  });

  it("requires OWNER auth, Origin, and CSRF for JSON commit", async () => {
    const session = await createOwnerAndSession();
    const preview = await upload(app, session, validCsvFile());
    const body = {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2],
      previewId: preview.json().previewId,
    };

    const unauthenticated = await commitImport(app, session, body, {});
    const missingOrigin = await commitImport(app, session, body, {
      cookie: session.cookie,
      "x-csrf-token": session.csrfToken,
    });
    const missingCsrf = await commitImport(app, session, body, {
      cookie: session.cookie,
      origin: ADMIN_ORIGIN,
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(missingOrigin.statusCode).toBe(403);
    expect(missingCsrf.statusCode).toBe(403);
  });

  it("atomically commits selected rows into invitation graphs, credentials, and one batch without RSVP side effects", async () => {
    const session = await createOwnerAndSession();
    const source = csv([
      "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
      validCsvRow("Commit Household One"),
      validCsvRow("Commit Household Two"),
    ]);
    const preview = await upload(app, session, source);
    const before = await counts();
    const response = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2, 3],
      previewId: preview.json().previewId,
    });
    const after = await counts();
    const storedPreview = await prisma.guestImportPreview.findUniqueOrThrow({
      where: { id: preview.json().previewId },
    });
    const createdInvitations = await prisma.invitation.findMany({
      orderBy: { displayName: "asc" },
      select: {
        displayName: true,
        id: true,
        publicTokenHash: true,
        publicTokenVersion: true,
      },
      where: {
        displayName: { in: ["Commit Household One", "Commit Household Two"] },
      },
    });
    const credentialService = app.get(CredentialService);
    const firstCredential = credentialService.deriveCredential({
      namespace: "invitation",
      stableId: createdInvitations[0]?.id ?? "",
      version: 1,
    });
    const publicLookup = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/public/invitations/${firstCredential}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      importBatch: {
        createdInvitationCount: 2,
        createdInviteeCount: 4,
        id: expect.stringMatching(
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
        ),
        status: "COMMITTED",
        warningCount: 0,
      },
    });
    expect(JSON.stringify(response.json())).not.toContain("publicCredential");
    expect(JSON.stringify(response.json())).not.toContain("publicUrl");
    expect(JSON.stringify(response.json())).not.toContain("publicTokenHash");
    expect(JSON.stringify(response.json())).not.toContain("normalizedRows");
    expect(after).toMatchObject({
      guestImportBatches: before.guestImportBatches + 1,
      invitationEvents: before.invitationEvents + 2,
      invitations: before.invitations + 2,
      invitees: before.invitees + 4,
      rsvpAttendees: before.rsvpAttendees,
      rsvpEventSelections: before.rsvpEventSelections,
      rsvps: before.rsvps,
    });
    expect(storedPreview.status).toBe(GuestImportPreviewStatus.COMMITTED);
    expect(storedPreview.commitFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(storedPreview.committedBatchId).toBe(response.json().importBatch.id);
    expect(storedPreview.normalizedRows).toEqual([]);
    expect(createdInvitations).toHaveLength(2);
    expect(createdInvitations.map((invitation) => invitation.publicTokenVersion)).toEqual([
      1,
      1,
    ]);
    expect(
      new Set(createdInvitations.map((invitation) => invitation.publicTokenHash))
        .size,
    ).toBe(2);
    expect(createdInvitations[0]?.publicTokenHash).toBe(
      credentialService.hashCredential(firstCredential),
    );
    expect(publicLookup.statusCode).toBe(200);
  });

  it("returns the existing batch for exact replay even after expiry and rejects a different replay", async () => {
    const session = await createOwnerAndSession();
    const preview = await upload(app, session, validCsvFile("Replay Household"));
    const exactBody = {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2],
      previewId: preview.json().previewId,
    };
    const first = await commitImport(app, session, exactBody);
    await prisma.guestImportPreview.update({
      data: { expiresAt: new Date(Date.now() - 60_000) },
      where: { id: preview.json().previewId },
    });
    const beforeReplay = await counts();
    const replay = await commitImport(app, session, exactBody);
    const differentReplay = await commitImport(app, session, {
      ...exactBody,
      acknowledgedWarningRowNumbers: [2],
    });
    const afterReplay = await counts();

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(differentReplay.statusCode).toBe(409);
    expect(differentReplay.json().error.code).toBe(
      "IMPORT_PREVIEW_ALREADY_COMMITTED",
    );
    expect(afterReplay).toEqual(beforeReplay);
  });

  it("treats array-order equivalent replay as the same canonical fingerprint", async () => {
    const session = await createOwnerAndSession();
    const source = csv([
      "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
      validCsvRow("Order Household One"),
      validCsvRow("Order Household Two"),
    ]);
    const preview = await upload(app, session, source);
    const first = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [3, 2],
      previewId: preview.json().previewId,
    });
    const beforeReplay = await counts();
    const replay = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2, 3],
      previewId: preview.json().previewId,
    });
    const afterReplay = await counts();

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(afterReplay).toEqual(beforeReplay);
  });

  it("validates selected rows, warning acknowledgements, preview ownership, and pending expiry before writing", async () => {
    const session = await createOwnerAndSession();
    const otherSession = await createOwnerAndSession("other-import@example.com");
    await createInvitation("Needs Ack Household");
    const warningPreview = await upload(
      app,
      session,
      validCsvFile("needs ack household"),
    );
    const expiredPreview = await upload(
      app,
      session,
      validCsvFile("Expired Household"),
    );
    await prisma.guestImportPreview.update({
      data: { expiresAt: new Date(Date.now() - 60_000) },
      where: { id: expiredPreview.json().previewId },
    });
    const before = await counts();

    const missingAck = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2],
      previewId: warningPreview.json().previewId,
    });
    const badAck = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [99],
      includeRowNumbers: [2],
      previewId: warningPreview.json().previewId,
    });
    const wrongOwner = await commitImport(app, otherSession, {
      acknowledgedWarningRowNumbers: [2],
      includeRowNumbers: [2],
      previewId: warningPreview.json().previewId,
    });
    const expired = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2],
      previewId: expiredPreview.json().previewId,
    });
    const withAck = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [2],
      includeRowNumbers: [2],
      previewId: warningPreview.json().previewId,
    });

    expect(missingAck.statusCode).toBe(400);
    expect(badAck.statusCode).toBe(400);
    expect(wrongOwner.statusCode).toBe(404);
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.code).toBe("IMPORT_PREVIEW_EXPIRED");
    expect(withAck.statusCode).toBe(200);
    expect(withAck.json().importBatch.warningCount).toBe(1);
    expect(await counts()).toMatchObject({
      guestImportBatches: before.guestImportBatches + 1,
      invitations: before.invitations + 1,
      invitees: before.invitees + 2,
    });
  });

  it("revalidates current Events and duplicate warnings inside the commit transaction", async () => {
    const session = await createOwnerAndSession();
    const eventDriftPreview = await upload(
      app,
      session,
      validCsvFile("Event Drift Household"),
    );
    await prisma.event.update({
      data: { isActive: false },
      where: { slug: "ceremony" },
    });
    const beforeEventDrift = await counts();
    await expectStaleCommit(app, session, {
      includeRowNumbers: [2],
      previewId: eventDriftPreview.json().previewId,
    });

    await prisma.event.update({
      data: { isActive: true },
      where: { slug: "ceremony" },
    });
    const duplicateDriftPreview = await upload(
      app,
      session,
      validCsvFile("Late Duplicate Household"),
    );
    await createInvitation(" late duplicate household ");
    const beforeDuplicateDrift = await counts();
    const duplicateDrift = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2],
      previewId: duplicateDriftPreview.json().previewId,
    });

    expect(await counts()).toMatchObject({
      guestImportBatches: beforeDuplicateDrift.guestImportBatches,
      invitationEvents: beforeDuplicateDrift.invitationEvents,
      invitees: beforeDuplicateDrift.invitees,
      rsvps: beforeDuplicateDrift.rsvps,
    });
    expect(beforeDuplicateDrift.invitations).toBe(beforeEventDrift.invitations + 1);
    expect(duplicateDrift.statusCode).toBe(409);
    expect(duplicateDrift.json().error.code).toBe("IMPORT_PREVIEW_STALE");
  });

  it.each(["renamed", "replaced"] as const)(
    "rejects a one-session preview after the Event slug is %s",
    async (change) => {
      const session = await createOwnerAndSession();
      const original = await prisma.event.findUniqueOrThrow({
        where: { slug: "ceremony" },
      });
      const file = validCsvFile("Identity drift household");
      const preview = await upload(app, session, file);
      expect(preview.statusCode).toBe(201);
      const previewId: string = preview.json().previewId;
      expect(
        (
          await prisma.guestImportPreview.findUniqueOrThrow({
            where: { id: previewId },
          })
        ).normalizedRows,
      ).toMatchObject([
        { eventSlugs: ["ceremony"], input: { eventIds: [original.id] } },
      ]);

      expect(
        (
          await manageEvent(
            app,
            session,
            { slug: "ceremony-moved", displayOrder: 1 },
            original,
          )
        ).statusCode,
      ).toBe(200);
      let replacementId: string | undefined;
      if (change === "replaced") {
        const replacement = await manageEvent(app, session, {
          slug: "ceremony",
          displayOrder: 2,
        });
        expect(replacement.statusCode).toBe(200);
        replacementId = replacement.json().id;
        expect(typeof replacementId).toBe("string");
        expect(replacementId).not.toBe(original.id);
      }

      await expectStaleCommit(app, session, {
        previewId,
        includeRowNumbers: [2],
      });

      if (replacementId) {
        const fresh = await upload(app, session, file);
        expect(fresh.statusCode).toBe(201);
        const committed = await commitImport(app, session, {
          previewId: fresh.json().previewId,
          includeRowNumbers: [2],
          acknowledgedWarningRowNumbers: [],
        });
        expect(committed.statusCode).toBe(200);
        expect(
          await prisma.invitationEvent.findMany({ select: { eventId: true } }),
        ).toEqual([{ eventId: replacementId }]);
      }
    },
  );

  it("rejects a selected batch when a two-session row drifts and permits the unaffected subset", async () => {
    const session = await createOwnerAndSession();
    const original = await prisma.event.findUniqueOrThrow({
      where: { slug: "ceremony" },
    });
    const reception = await createEvent({ slug: "reception", displayOrder: 2 });
    const preview = await upload(
      app,
      session,
      csv([
        "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony,event:reception",
        validCsvRow("Unchanged household", "false,true"),
        validCsvRow("Drifted household", "true,true"),
      ]),
    );
    expect(preview.statusCode).toBe(201);
    const previewId: string = preview.json().previewId;

    expect(
      (
        await manageEvent(
          app,
          session,
          { slug: "ceremony-moved", displayOrder: 1 },
          original,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await manageEvent(app, session, { slug: "ceremony", displayOrder: 3 }))
        .statusCode,
    ).toBe(200);

    await expectStaleCommit(app, session, {
      previewId,
      includeRowNumbers: [2, 3],
    });
    const beforeSubset = await counts();
    const subset = await commitImport(app, session, {
      previewId,
      includeRowNumbers: [2],
      acknowledgedWarningRowNumbers: [],
    });
    expect(subset.statusCode).toBe(200);
    expect(await counts()).toEqual({
      ...beforeSubset,
      invitations: beforeSubset.invitations + 1,
      invitees: beforeSubset.invitees + 2,
      invitationEvents: beforeSubset.invitationEvents + 1,
      guestImportBatches: beforeSubset.guestImportBatches + 1,
    });
    expect(
      await prisma.invitationEvent.findMany({
        select: {
          eventId: true,
          invitation: { select: { displayName: true } },
        },
      }),
    ).toEqual([
      {
        eventId: reception.id,
        invitation: { displayName: "Unchanged household" },
      },
    ]);
  });

  it("rejects exchanged slugs even when the two Event UUIDs have not changed", async () => {
    const session = await createOwnerAndSession();
    const ceremony = await prisma.event.findUniqueOrThrow({
      where: { slug: "ceremony" },
    });
    const reception = await createEvent({ slug: "reception", displayOrder: 2 });
    const preview = await upload(app, session, twoSessionCsv());
    expect(preview.statusCode).toBe(201);
    const previewId: string = preview.json().previewId;

    const moved = await manageEvent(
      app,
      session,
      { slug: "ceremony-moved", displayOrder: 1 },
      ceremony,
    );
    expect(moved.statusCode).toBe(200);
    expect(
      (
        await manageEvent(
          app,
          session,
          { slug: "ceremony", displayOrder: 2 },
          reception,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await manageEvent(
          app,
          session,
          { slug: "reception", displayOrder: 1 },
          {
            id: ceremony.id,
            version: moved.json().version,
          },
        )
      ).statusCode,
    ).toBe(200);
    expect(
      await prisma.event.findUnique({
        where: { slug: "ceremony" },
        select: { id: true },
      }),
    ).toEqual({ id: reception.id });
    expect(
      await prisma.event.findUnique({
        where: { slug: "reception" },
        select: { id: true },
      }),
    ).toEqual({ id: ceremony.id });

    await expectStaleCommit(app, session, {
      previewId,
      includeRowNumbers: [2],
    });
  });

  it.each([
    "reordered pairs",
    "case-insensitive duplicate",
    "mismatched pairs",
    "unknown UUID",
  ] as const)(
    "validates stored %s against the current Event identities",
    async (variant) => {
      const session = await createOwnerAndSession();
      const ceremony = await prisma.event.findUniqueOrThrow({
        where: { slug: "ceremony" },
      });
      const reception = await createEvent({
        slug: "reception",
        displayOrder: 2,
      });
      const preview = await upload(app, session, twoSessionCsv());
      expect(preview.statusCode).toBe(201);
      const previewId: string = preview.json().previewId;
      const { normalizedRows } =
        await prisma.guestImportPreview.findUniqueOrThrow({
          where: { id: previewId },
        });
      const [row] = normalizedRows as Array<{
        eventSlugs: string[];
        input: { eventIds: string[] };
      }>;
      if (!row) throw new Error("Expected a persisted preview row");
      expect(row.eventSlugs).toEqual([ceremony.slug, reception.slug]);
      expect(row.input.eventIds).toEqual([ceremony.id, reception.id]);

      const [eventSlugs, eventIds] = (
        {
          "reordered pairs": [
            [reception.slug, ceremony.slug],
            [reception.id.toUpperCase(), ceremony.id],
          ],
          "case-insensitive duplicate": [
            row.eventSlugs,
            [ceremony.id, ceremony.id.toUpperCase()],
          ],
          "mismatched pairs": [row.eventSlugs, [reception.id, ceremony.id]],
          "unknown UUID": [row.eventSlugs, [ceremony.id, randomUUID()]],
        } satisfies Record<typeof variant, [string[], string[]]>
      )[variant];
      await prisma.guestImportPreview.update({
        where: { id: previewId },
        data: {
          normalizedRows: [
            { ...row, eventSlugs, input: { ...row.input, eventIds } },
          ],
        },
      });

      if (variant === "reordered pairs") {
        const result = await commitImport(app, session, {
          previewId,
          includeRowNumbers: [2],
          acknowledgedWarningRowNumbers: [],
        });
        expect(result.statusCode).toBe(200);
        const assignments = await prisma.invitationEvent.findMany({
          select: { eventId: true },
        });
        expect(assignments.map(({ eventId }) => eventId).sort()).toEqual(
          [ceremony.id, reception.id].sort(),
        );
      } else {
        await expectStaleCommit(app, session, {
          previewId,
          includeRowNumbers: [2],
        });
      }
    },
  );

  it("replays the original committed receipt after historical Event identity drift", async () => {
    const session = await createOwnerAndSession();
    const preview = await upload(
      app,
      session,
      validCsvFile("Historical receipt household"),
    );
    expect(preview.statusCode).toBe(201);
    const command = {
      previewId: preview.json().previewId as string,
      includeRowNumbers: [2],
      acknowledgedWarningRowNumbers: [],
    };
    const first = await commitImport(app, session, command);
    expect(first.statusCode).toBe(200);

    // Model historical data drift. Event Management disallows this rename
    // after the first import has created an eligibility reference.
    const original = await prisma.event.update({
      where: { slug: "ceremony" },
      data: { slug: "ceremony-moved", isActive: false },
    });
    expect(
      (await manageEvent(app, session, { slug: "ceremony", displayOrder: 2 }))
        .statusCode,
    ).toBe(200);

    const beforeReplay = await counts();
    const replay = await commitImport(app, session, command);
    const different = await commitImport(app, session, {
      ...command,
      includeRowNumbers: [3],
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(different.statusCode).toBe(409);
    expect(different.json().error.code).toBe(
      "IMPORT_PREVIEW_ALREADY_COMMITTED",
    );
    expect(await counts()).toEqual(beforeReplay);
    expect(
      await prisma.invitationEvent.findMany({ select: { eventId: true } }),
    ).toEqual([{ eventId: original.id }]);
  });

  it("waits for concurrent Event Management under row locks and rechecks the approved slug", async () => {
    const session = await createOwnerAndSession();
    const ceremony = await prisma.event.findUniqueOrThrow({
      where: { slug: "ceremony" },
    });
    const preview = await upload(
      app,
      session,
      validCsvFile("Concurrent event configuration"),
    );
    expect(preview.statusCode).toBe(201);
    const previewId: string = preview.json().previewId;
    const gate = new Client({ connectionString: getDatabaseUrl() });
    await gate.connect();
    let rename: ReturnType<typeof manageEvent> | undefined;
    let commit: ReturnType<typeof commitImport> | undefined;
    const before = await counts();
    try {
      await gate.query("BEGIN");
      await gate.query("SELECT id FROM events WHERE id = $1 FOR UPDATE", [
        ceremony.id,
      ]);
      rename = manageEvent(
        app,
        session,
        { slug: "ceremony-moved", displayOrder: 1 },
        ceremony,
      );
      await waitForEventLock("FOR UPDATE");
      commit = commitImport(app, session, {
        previewId,
        includeRowNumbers: [2],
        acknowledgedWarningRowNumbers: [],
      });
      await waitForEventLock("FOR SHARE");
      await gate.query("COMMIT");

      expect((await rename).statusCode).toBe(200);
      await expectStaleResponse(previewId, before, await commit);
    } finally {
      await gate.query("ROLLBACK");
      await gate.end();
      await Promise.allSettled([rename, commit]);
    }
  });

  it("serializes concurrent commits for the same preview without duplicate invitation writes", async () => {
    const session = await createOwnerAndSession();
    const source = csv([
      "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
      validCsvRow("Concurrent Household One"),
      validCsvRow("Concurrent Household Two"),
    ]);
    const preview = await upload(app, session, source);
    const before = await counts();
    const responses = await Promise.all([
      commitImport(app, session, {
        acknowledgedWarningRowNumbers: [],
        includeRowNumbers: [2],
        previewId: preview.json().previewId,
      }),
      commitImport(app, session, {
        acknowledgedWarningRowNumbers: [],
        includeRowNumbers: [3],
        previewId: preview.json().previewId,
      }),
    ]);
    const after = await counts();

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200,
      409,
    ]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json().error
        .code,
    ).toBe("IMPORT_PREVIEW_ALREADY_COMMITTED");
    expect(after).toMatchObject({
      guestImportBatches: before.guestImportBatches + 1,
      invitations: before.invitations + 1,
      invitees: before.invitees + 2,
    });
  });

  it("returns one batch for concurrent same-fingerprint commits", async () => {
    const session = await createOwnerAndSession();
    const preview = await upload(
      app,
      session,
      validCsvFile("Same Fingerprint Household"),
    );
    const before = await counts();
    const body = {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: [2],
      previewId: preview.json().previewId,
    };
    const responses = await Promise.all([
      commitImport(app, session, body),
      commitImport(app, session, body),
    ]);
    const after = await counts();
    const batchIds = responses.map(
      (response) => response.json().importBatch.id as string,
    );

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(new Set(batchIds).size).toBe(1);
    expect(after).toMatchObject({
      guestImportBatches: before.guestImportBatches + 1,
      invitations: before.invitations + 1,
      invitees: before.invitees + 2,
    });
  });

  it("rolls back the first inserted invitation graph when a later row fails inside the transaction", async () => {
    const session = await createOwnerAndSession();
    const source = csv([
      "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
      validCsvRow("Rollback Household One"),
      validCsvRow("Rollback Household Two"),
    ]);
    const preview = await upload(app, session, source);
    const before = await counts();
    const credentialService = app.get(CredentialService);
    const originalDeriveCredential =
      credentialService.deriveCredential.bind(credentialService);
    let deriveCount = 0;
    const spy = vi
      .spyOn(credentialService, "deriveCredential")
      .mockImplementation((command) => {
        deriveCount += 1;

        if (deriveCount === 2) {
          throw new Error("forced import rollback");
        }

        return originalDeriveCredential(command);
      });

    try {
      const response = await commitImport(app, session, {
        acknowledgedWarningRowNumbers: [],
        includeRowNumbers: [2, 3],
        previewId: preview.json().previewId,
      });

      expect(response.statusCode).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await counts()).toEqual(before);
    await expect(
      prisma.guestImportPreview.findUniqueOrThrow({
        where: { id: preview.json().previewId },
      }),
    ).resolves.toMatchObject({
      committedBatchId: null,
      status: GuestImportPreviewStatus.PENDING,
    });
  });

  it("commits the 500-row maximum against real PostgreSQL within one atomic batch", async () => {
    const session = await createOwnerAndSession();
    const rows = Array.from({ length: 500 }, (_value, index) =>
      validCsvRow(`Bulk Household ${index.toString().padStart(3, "0")}`),
    );
    const preview = await upload(
      app,
      session,
      csv([
        "displayName,greetingName,allowPlusOne,maxAdditionalChildren,rsvpDeadlineLocal,notes,invitees,event:ceremony",
        ...rows,
      ]),
      "bulk.csv",
    );
    const startedAt = Date.now();
    const response = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [],
      includeRowNumbers: Array.from({ length: 500 }, (_value, index) => index + 2),
      previewId: preview.json().previewId,
    });
    const durationMs = Date.now() - startedAt;

    expect(response.statusCode).toBe(200);
    expect(response.json().importBatch).toMatchObject({
      createdInvitationCount: 500,
      createdInviteeCount: 1000,
      status: "COMMITTED",
      warningCount: 0,
    });
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });
});
