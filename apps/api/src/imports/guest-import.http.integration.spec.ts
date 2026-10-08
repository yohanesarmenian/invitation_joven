import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import ExcelJS from "exceljs";
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
    const eventDrift = await commitImport(app, session, {
      acknowledgedWarningRowNumbers: [],
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

    expect(eventDrift.statusCode).toBe(409);
    expect(eventDrift.json().error.code).toBe("IMPORT_PREVIEW_STALE");
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
