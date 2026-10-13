import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { configureApp } from "../app.setup.js";
import { AdminPasswordService } from "../auth/password.service.js";
import { AdminSessionTokenService } from "../auth/session-token.service.js";
import { getDatabaseUrl } from "../database/database-url.js";
import {
  AdminRole,
  AdminUserStatus,
  CheckinMethod,
  CheckinPassStatus,
  InvitationStatus,
  InviteeCategory,
  Prisma,
  PrismaClient,
  RSVPAttendeeType,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { CredentialService } from "../security/credential.service.js";
import type { DerivedCredential } from "../security/credential.types.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const PUBLIC_ORIGIN = "http://localhost:3000";
const OWNER_EMAIL = "owner-checkin@example.com";
const STAFF_EMAIL = "staff-checkin@example.com";
const PASSWORD = "correct horse battery staple";
const CREDENTIAL_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

process.env.CREDENTIAL_SECRET ??= CREDENTIAL_SECRET;

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const passwordService = new AdminPasswordService();
const tokenService = new AdminSessionTokenService();

type AdminSessionFixture = Awaited<ReturnType<typeof createUserAndSession>>;
type TestTransaction = Prisma.TransactionClient;

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

async function createUserAndSession(input: {
  email: string;
  mustChangePassword?: boolean;
  role: AdminRole;
}) {
  const user = await prisma.adminUser.create({
    data: {
      email: input.email,
      mustChangePassword: input.mustChangePassword ?? false,
      passwordHash: await passwordService.hashPassword(PASSWORD),
      role: input.role,
      status: AdminUserStatus.ACTIVE,
    },
  });
  const tokens = tokenService.generateSessionTokens();

  await prisma.adminSession.create({
    data: {
      adminUserId: user.id,
      csrfTokenHash: tokens.csrfTokenHash,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      sessionTokenHash: tokens.sessionTokenHash,
    },
  });

  return {
    cookie: `admin_session=${tokens.sessionToken}`,
    csrfToken: tokens.csrfToken,
    user,
  };
}

function unsafeHeaders(session: AdminSessionFixture) {
  return {
    cookie: session.cookie,
    origin: ADMIN_ORIGIN,
    "x-csrf-token": session.csrfToken,
  };
}

async function createCheckinFixture(
  credentialService: CredentialService,
  input: {
    displayName?: string;
    eventName?: string;
    eventSelected?: boolean;
    expectedAttendeeCount?: number;
    passStatus?: CheckinPassStatus;
    secondEventEligible?: boolean;
    withPass?: boolean;
  } = {},
) {
  const displayOrderBase = randomInt(1, 1_000_000_000);
  const invitationId = randomUUID();
  const publicCredential = credentialService.deriveCredential({
    namespace: "invitation",
    stableId: invitationId,
    version: 1,
  });
  const invitation = await prisma.invitation.create({
    data: {
      displayName: input.displayName ?? `Check-in Household ${invitationId}`,
      greetingName: "Check-in Guests",
      id: invitationId,
      publicTokenHash: credentialService.hashCredential(publicCredential),
      publicTokenVersion: 1,
      status: InvitationStatus.ACTIVE,
    },
  });
  const event = await prisma.event.create({
    data: {
      displayOrder: displayOrderBase,
      name: input.eventName ?? "Check-in Reception",
      slug: `checkin-event-${randomUUID()}`,
      startsAt: new Date("2026-12-12T12:00:00.000Z"),
    },
  });
  const otherEvent = await prisma.event.create({
    data: {
      displayOrder: displayOrderBase + 1,
      name: "Different Event",
      slug: `checkin-other-${randomUUID()}`,
    },
  });
  await prisma.invitationEvent.create({
    data: {
      eventId: event.id,
      invitationId: invitation.id,
    },
  });
  if (input.secondEventEligible === true) {
    await prisma.invitationEvent.create({
      data: {
        eventId: otherEvent.id,
        invitationId: invitation.id,
      },
    });
  }
  const invitee = await prisma.invitee.create({
    data: {
      category: InviteeCategory.ADULT,
      displayOrder: 10,
      fullName: "Manual Search Guest",
      invitationId: invitation.id,
    },
  });
  const rsvp = await prisma.rSVP.create({
    data: {
      invitationId: invitation.id,
      status: RSVPStatus.ACCEPTED,
      version: 1,
    },
  });
  await prisma.rSVPAttendee.create({
    data: {
      attendeeType: RSVPAttendeeType.NAMED_INVITEE,
      inviteeId: invitee.id,
      quantity: 1,
      rsvpId: rsvp.id,
    },
  });
  const expectedAttendeeCount =
    input.eventSelected === false ? 0 : (input.expectedAttendeeCount ?? 1);
  await prisma.rSVPEventSelection.create({
    data: {
      attending: input.eventSelected ?? true,
      eventId: event.id,
      expectedAttendeeCount,
      rsvpId: rsvp.id,
    },
  });
  if (input.secondEventEligible === true) {
    await prisma.rSVPEventSelection.create({
      data: {
        attending: true,
        eventId: otherEvent.id,
        expectedAttendeeCount: 1,
        rsvpId: rsvp.id,
      },
    });
  }

  let qrPayload: DerivedCredential | null = null;
  let checkinPassId: string | null = null;

  if (input.withPass !== false) {
    checkinPassId = randomUUID();
    qrPayload = credentialService.deriveCredential({
      namespace: "check-in",
      stableId: checkinPassId,
      version: 1,
    });
    await prisma.checkinPass.create({
      data: {
        credentialVersion: 1,
        id: checkinPassId,
        invitationId: invitation.id,
        revokedAt:
          input.passStatus === CheckinPassStatus.REVOKED
            ? new Date("2026-10-01T00:00:00.000Z")
            : null,
        revocationReason:
          input.passStatus === CheckinPassStatus.REVOKED
            ? "TEST_REVOKED"
            : null,
        rsvpId: rsvp.id,
        status: input.passStatus ?? CheckinPassStatus.ACTIVE,
        tokenHash: credentialService.hashCredential(qrPayload),
      },
    });
  }

  return {
    checkinPassId,
    event,
    invitation,
    invitee,
    otherEvent,
    publicCredential,
    qrPayload,
    rsvp,
  };
}

function publicAcceptedPayload(input: {
  eventId: string;
  expectedVersion: number;
  inviteeId: string;
}) {
  return {
    attendees: [
      {
        inviteeId: input.inviteeId,
        quantity: 1,
        type: "NAMED_INVITEE",
      },
    ],
    dietaryNotes: null,
    eventSelections: [
      {
        attending: true,
        eventId: input.eventId,
        expectedAttendeeCount: 1,
      },
    ],
    expectedVersion: input.expectedVersion,
    status: "ACCEPTED",
  };
}

function publicDeclinedPayload(expectedVersion: number) {
  return {
    attendees: [],
    dietaryNotes: null,
    eventSelections: [],
    expectedVersion,
    status: "DECLINED",
  };
}

function adminOverridePayload(input: {
  eventId: string;
  expectedVersion: number;
  inviteeId: string;
}) {
  return {
    ...publicAcceptedPayload(input),
    overrideReason: "Venue check-in reconciliation",
  };
}

function qrConfirmRequest(
  app: NestFastifyApplication,
  input: {
    attendeeCount?: number;
    eventId: string;
    qrPayload: string | null;
    session: AdminSessionFixture;
  },
) {
  return app.getHttpAdapter().getInstance().inject({
    headers: unsafeHeaders(input.session),
    method: "POST",
    payload: {
      attendeeCount: input.attendeeCount ?? 1,
      eventId: input.eventId,
      qrPayload: input.qrPayload,
    },
    url: "/api/admin/checkin/confirm",
  });
}

function manualConfirmRequest(
  app: NestFastifyApplication,
  input: {
    attendeeCount?: number;
    eventId: string;
    invitationId: string;
    session: AdminSessionFixture;
  },
) {
  return app.getHttpAdapter().getInstance().inject({
    headers: unsafeHeaders(input.session),
    method: "POST",
    payload: {
      attendeeCount: input.attendeeCount ?? 1,
      eventId: input.eventId,
      invitationId: input.invitationId,
    },
    url: "/api/admin/checkin/manual-confirm",
  });
}

async function startRequestBehindInvitationLock<T>(
  invitationId: string,
  startRequest: () => Promise<T>,
  mutateWhileLocked: (tx: TestTransaction) => Promise<void>,
): Promise<T> {
  let request: Promise<T> | undefined;

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "invitations"
      WHERE "id" = ${invitationId}::uuid
      FOR UPDATE
    `;

    request = startRequest();
    await mutateWhileLocked(tx);
  });

  if (request === undefined) {
    throw new Error("Expected request to start behind invitation lock.");
  }

  return request;
}

describe("admin check-in HTTP integration", () => {
  let app: NestFastifyApplication;
  let credentialService: CredentialService;

  beforeAll(async () => {
    process.env.ADMIN_ORIGIN = ADMIN_ORIGIN;
    process.env.NODE_ENV = "test";

    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { bufferLogs: true },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    credentialService = app.get(CredentialService);
  });

  beforeEach(async () => {
    process.env.ADMIN_ORIGIN = ADMIN_ORIGIN;
    process.env.NODE_ENV = "test";
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
    await prisma.$disconnect();
  });

  it("allows CHECKIN_STAFF to validate and confirm QR check-ins without exposing credentials", async () => {
    const staffSession = await createUserAndSession({
      email: STAFF_EMAIL,
      role: AdminRole.CHECKIN_STAFF,
    });
    const ownerSession = await createUserAndSession({
      email: OWNER_EMAIL,
      role: AdminRole.OWNER,
    });
    const fixture = await createCheckinFixture(credentialService, {
      secondEventEligible: true,
    });

    const events = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: staffSession.cookie },
      method: "GET",
      url: "/api/admin/checkin/events",
    });
    const validate = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
      },
      url: "/api/admin/checkin/validate",
    });
    const beforeCount = await prisma.checkinRecord.count();
    const confirm = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        attendeeCount: 1,
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
      },
      url: "/api/admin/checkin/confirm",
    });
    const secondEventConfirm = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        attendeeCount: 1,
        eventId: fixture.otherEvent.id,
        qrPayload: fixture.qrPayload,
      },
      url: "/api/admin/checkin/confirm",
    });
    const duplicate = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        attendeeCount: 1,
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
      },
      url: "/api/admin/checkin/confirm",
    });
    const lostResponseRecovery = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
      },
      url: "/api/admin/checkin/validate",
    });
    const publicRsvpAfterCheckin = await app.getHttpAdapter().getInstance().inject({
      headers: {
        origin: PUBLIC_ORIGIN,
      },
      method: "PUT",
      payload: publicAcceptedPayload({
        eventId: fixture.event.id,
        expectedVersion: 1,
        inviteeId: fixture.invitee.id,
      }),
      url: `/api/public/invitations/${fixture.publicCredential}/rsvp`,
    });
    const adminOverrideAfterCheckin = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: unsafeHeaders(ownerSession),
        method: "PUT",
        payload: adminOverridePayload({
          eventId: fixture.event.id,
          expectedVersion: 1,
          inviteeId: fixture.invitee.id,
        }),
        url: `/api/admin/invitations/${fixture.invitation.id}/rsvp`,
      });

    expect(events.statusCode).toBe(200);
    expect(events.json().events).toEqual([
      expect.objectContaining({
        id: fixture.event.id,
        name: fixture.event.name,
        startsAt: fixture.event.startsAt?.toISOString(),
      }),
      expect.objectContaining({ id: fixture.otherEvent.id }),
    ]);
    expect(validate.statusCode).toBe(200);
    expect(validate.json()).toEqual({
      alreadyCheckedIn: false,
      event: { id: fixture.event.id, name: fixture.event.name },
      expectedAttendeeCount: 1,
      invitation: {
        displayName: fixture.invitation.displayName,
        id: fixture.invitation.id,
      },
      previousCheckin: null,
      status: "VALID",
    });
    expect(beforeCount).toBe(0);
    expect(confirm.statusCode).toBe(201);
    expect(confirm.json()).toEqual({
      checkinRecord: {
        attendeeCount: 1,
        checkedInAt: expect.any(String),
        confirmedBy: {
          email: STAFF_EMAIL,
          id: staffSession.user.id,
          role: AdminRole.CHECKIN_STAFF,
        },
        id: expect.any(String),
        method: CheckinMethod.QR,
      },
    });
    expect(confirm.body).not.toContain(fixture.qrPayload ?? "");
    expect(confirm.body).not.toContain(fixture.checkinPassId ?? "");
    expect(confirm.body).not.toContain("tokenHash");
    expect(secondEventConfirm.statusCode).toBe(201);
    expect(secondEventConfirm.json().checkinRecord).toMatchObject({
      attendeeCount: 1,
      method: CheckinMethod.QR,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("CHECKIN_ALREADY_CONFIRMED");
    expect(lostResponseRecovery.statusCode).toBe(200);
    expect(lostResponseRecovery.json()).toMatchObject({
      alreadyCheckedIn: true,
      previousCheckin: {
          attendeeCount: 1,
        confirmedBy: {
          email: STAFF_EMAIL,
          id: staffSession.user.id,
          role: AdminRole.CHECKIN_STAFF,
        },
        method: CheckinMethod.QR,
      },
      status: "ALREADY_CONFIRMED",
    });
    expect(publicRsvpAfterCheckin.statusCode).toBe(409);
    expect(publicRsvpAfterCheckin.json().error).toMatchObject({
      code: "RSVP_LOCKED_AFTER_CHECKIN",
      message: "RSVP is locked after check-in.",
    });
    expect(adminOverrideAfterCheckin.statusCode).toBe(409);
    expect(adminOverrideAfterCheckin.json().error).toMatchObject({
      code: "RSVP_LOCKED_AFTER_CHECKIN",
      message: "RSVP is locked after check-in.",
    });
    await expect(prisma.checkinRecord.count()).resolves.toBe(2);
  });

  it("supports bounded manual search and manual confirmation through the shared domain guard", async () => {
    const staffSession = await createUserAndSession({
      email: STAFF_EMAIL,
      role: AdminRole.CHECKIN_STAFF,
    });
    const fixture = await createCheckinFixture(credentialService, {
      displayName: "Manual Search Household",
      withPass: false,
    });

    const search = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: staffSession.cookie },
      method: "GET",
      url: `/api/admin/checkin/search?query=manual&eventId=${fixture.event.id}`,
    });
    const confirm = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        attendeeCount: 1,
        eventId: fixture.event.id,
        invitationId: fixture.invitation.id,
      },
      url: "/api/admin/checkin/manual-confirm",
    });

    expect(search.statusCode).toBe(200);
    expect(search.json()).toEqual({
      items: [
        {
          alreadyCheckedIn: false,
          event: {
            id: fixture.event.id,
            name: fixture.event.name,
          },
          expectedAttendeeCount: 1,
          invitation: {
            displayName: fixture.invitation.displayName,
            id: fixture.invitation.id,
          },
        },
      ],
    });
    expect(search.body).not.toContain("publicTokenHash");
    expect(search.body).not.toContain("qrPayload");
    expect(search.body).not.toContain("tokenHash");
    expect(confirm.statusCode).toBe(201);
    expect(confirm.json().checkinRecord).toMatchObject({
      attendeeCount: 1,
      confirmedBy: {
        email: STAFF_EMAIL,
        id: staffSession.user.id,
        role: AdminRole.CHECKIN_STAFF,
      },
      method: CheckinMethod.MANUAL,
    });
    await expect(
      prisma.checkinRecord.findFirstOrThrow({
        where: { invitationId: fixture.invitation.id },
      }),
    ).resolves.toMatchObject({
      attendeeCount: 1,
      checkinPassId: null,
      method: CheckinMethod.MANUAL,
    });
  });

  it("rejects invalid credentials, revoked passes, unselected events, and must-change-password sessions", async () => {
    const staffSession = await createUserAndSession({
      email: STAFF_EMAIL,
      role: AdminRole.CHECKIN_STAFF,
    });
    const mustChangeSession = await createUserAndSession({
      email: "must-change-checkin@example.com",
      mustChangePassword: true,
      role: AdminRole.CHECKIN_STAFF,
    });
    const fixture = await createCheckinFixture(credentialService);
    const revoked = await createCheckinFixture(credentialService, {
      passStatus: CheckinPassStatus.REVOKED,
    });
    const unselected = await createCheckinFixture(credentialService, {
      eventSelected: false,
    });

    const unauthenticated = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/admin/checkin/events",
    });
    const mustChange = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: mustChangeSession.cookie },
      method: "GET",
      url: "/api/admin/checkin/events",
    });
    const invalid = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        eventId: fixture.event.id,
        qrPayload: "A".repeat(43),
      },
      url: "/api/admin/checkin/validate",
    });
    const revokedResponse = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        eventId: revoked.event.id,
        qrPayload: revoked.qrPayload,
      },
      url: "/api/admin/checkin/validate",
    });
    const wrongEvent = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        eventId: fixture.otherEvent.id,
        qrPayload: fixture.qrPayload,
      },
      url: "/api/admin/checkin/validate",
    });
    const eventNotSelected = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        eventId: unselected.event.id,
        qrPayload: unselected.qrPayload,
      },
      url: "/api/admin/checkin/validate",
    });
    const zeroAttendees = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        attendeeCount: 0,
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
      },
      url: "/api/admin/checkin/confirm",
    });
    const tooManyAttendees = await app.getHttpAdapter().getInstance().inject({
      headers: unsafeHeaders(staffSession),
      method: "POST",
      payload: {
        attendeeCount: 2,
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
      },
      url: "/api/admin/checkin/confirm",
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(mustChange.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe("QR_INVALID");
    expect(invalid.body).not.toContain("A".repeat(43));
    expect(revokedResponse.statusCode).toBe(422);
    expect(revokedResponse.json().error.code).toBe("QR_REVOKED");
    expect(wrongEvent.statusCode).toBe(422);
    expect(wrongEvent.json().error.code).toBe("EVENT_NOT_ALLOWED");
    expect(eventNotSelected.statusCode).toBe(422);
    expect(eventNotSelected.json().error.code).toBe("EVENT_NOT_SELECTED");
    expect(zeroAttendees.statusCode).toBe(422);
    expect(zeroAttendees.json().error.code).toBe("INVALID_ATTENDEE_COUNT");
    expect(tooManyAttendees.statusCode).toBe(422);
    expect(tooManyAttendees.json().error.code).toBe("INVALID_ATTENDEE_COUNT");
    await expect(prisma.checkinRecord.count()).resolves.toBe(0);
  });

  it("serializes concurrent QR confirmations to one persisted record with winner attribution", async () => {
    const firstStaffSession = await createUserAndSession({
      email: "first-qr-checkin@example.com",
      role: AdminRole.CHECKIN_STAFF,
    });
    const secondStaffSession = await createUserAndSession({
      email: "second-qr-checkin@example.com",
      role: AdminRole.CHECKIN_STAFF,
    });
    const fixture = await createCheckinFixture(credentialService);

    const responses = await Promise.all([
      qrConfirmRequest(app, {
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
        session: firstStaffSession,
      }),
      qrConfirmRequest(app, {
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
        session: secondStaffSession,
      }),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    const winner = responses.find((response) => response.statusCode === 201);

    expect(statuses).toEqual([201, 409]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json().error
        .code,
    ).toBe("CHECKIN_ALREADY_CONFIRMED");
    expect(winner?.json().checkinRecord).toMatchObject({
      attendeeCount: 1,
      method: CheckinMethod.QR,
    });

    const winnerOperatorId = winner?.json().checkinRecord.confirmedBy.id;
    expect([firstStaffSession.user.id, secondStaffSession.user.id]).toContain(
      winnerOperatorId,
    );
    const record = await prisma.checkinRecord.findUniqueOrThrow({
      where: {
        invitationId_eventId: {
          eventId: fixture.event.id,
          invitationId: fixture.invitation.id,
        },
      },
    });
    expect(record).toMatchObject({
      attendeeCount: 1,
      checkinPassId: fixture.checkinPassId,
      confirmedByAdminUserId: winnerOperatorId,
      method: CheckinMethod.QR,
    });
    await expect(prisma.checkinRecord.count()).resolves.toBe(1);
  });

  it("serializes concurrent QR and manual confirmations through the shared domain guard", async () => {
    const qrStaffSession = await createUserAndSession({
      email: "qr-manual-qr@example.com",
      role: AdminRole.CHECKIN_STAFF,
    });
    const manualStaffSession = await createUserAndSession({
      email: "qr-manual-manual@example.com",
      role: AdminRole.CHECKIN_STAFF,
    });
    const fixture = await createCheckinFixture(credentialService);

    const responses = await Promise.all([
      qrConfirmRequest(app, {
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
        session: qrStaffSession,
      }),
      manualConfirmRequest(app, {
        eventId: fixture.event.id,
        invitationId: fixture.invitation.id,
        session: manualStaffSession,
      }),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    const winner = responses.find((response) => response.statusCode === 201);
    const winningMethod = winner?.json().checkinRecord.method;

    expect(statuses).toEqual([201, 409]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json().error
        .code,
    ).toBe("CHECKIN_ALREADY_CONFIRMED");

    const record = await prisma.checkinRecord.findUniqueOrThrow({
      where: {
        invitationId_eventId: {
          eventId: fixture.event.id,
          invitationId: fixture.invitation.id,
        },
      },
    });
    expect(record.attendeeCount).toBe(1);
    if (winningMethod === CheckinMethod.QR) {
      expect(record).toMatchObject({
        checkinPassId: fixture.checkinPassId,
        confirmedByAdminUserId: qrStaffSession.user.id,
        method: CheckinMethod.QR,
      });
    } else {
      expect(record).toMatchObject({
        checkinPassId: null,
        confirmedByAdminUserId: manualStaffSession.user.id,
        method: CheckinMethod.MANUAL,
      });
    }
    await expect(prisma.checkinRecord.count()).resolves.toBe(1);
  });

  it("allows concurrent confirmations for the same household across different events", async () => {
    const firstStaffSession = await createUserAndSession({
      email: "first-event-checkin@example.com",
      role: AdminRole.CHECKIN_STAFF,
    });
    const secondStaffSession = await createUserAndSession({
      email: "second-event-checkin@example.com",
      role: AdminRole.CHECKIN_STAFF,
    });
    const fixture = await createCheckinFixture(credentialService, {
      secondEventEligible: true,
    });

    const responses = await Promise.all([
      qrConfirmRequest(app, {
        eventId: fixture.event.id,
        qrPayload: fixture.qrPayload,
        session: firstStaffSession,
      }),
      qrConfirmRequest(app, {
        eventId: fixture.otherEvent.id,
        qrPayload: fixture.qrPayload,
        session: secondStaffSession,
      }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201,
      201,
    ]);
    await expect(
      prisma.checkinRecord.count({
        where: { invitationId: fixture.invitation.id },
      }),
    ).resolves.toBe(2);
    const records = await prisma.checkinRecord.findMany({
      orderBy: { eventId: "asc" },
      where: { invitationId: fixture.invitation.id },
    });
    expect(records.map((record) => record.eventId).sort()).toEqual(
      [fixture.event.id, fixture.otherEvent.id].sort(),
    );
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          confirmedByAdminUserId: firstStaffSession.user.id,
          eventId: fixture.event.id,
          method: CheckinMethod.QR,
        }),
        expect.objectContaining({
          confirmedByAdminUserId: secondStaffSession.user.id,
          eventId: fixture.otherEvent.id,
          method: CheckinMethod.QR,
        }),
      ]),
    );
  });

  it("revalidates RSVP and attendee state after invitation-lock race ordering", async () => {
    const staffSession = await createUserAndSession({
      email: "race-checkin-staff@example.com",
      role: AdminRole.CHECKIN_STAFF,
    });
    const ownerSession = await createUserAndSession({
      email: "race-checkin-owner@example.com",
      role: AdminRole.OWNER,
    });

    const declinedFirst = await createCheckinFixture(credentialService);
    const declinedFirstResponse = await startRequestBehindInvitationLock(
      declinedFirst.invitation.id,
      () =>
        qrConfirmRequest(app, {
          eventId: declinedFirst.event.id,
          qrPayload: declinedFirst.qrPayload,
          session: staffSession,
        }),
      async (tx) => {
        await tx.rSVP.update({
          data: {
            status: RSVPStatus.DECLINED,
            version: { increment: 1 },
          },
          where: { id: declinedFirst.rsvp.id },
        });
        await tx.rSVPEventSelection.deleteMany({
          where: { rsvpId: declinedFirst.rsvp.id },
        });
      },
    );

    expect(declinedFirstResponse.statusCode).toBe(422);
    expect(declinedFirstResponse.json().error.code).toBe("EVENT_NOT_SELECTED");
    await expect(
      prisma.checkinRecord.count({
        where: { invitationId: declinedFirst.invitation.id },
      }),
    ).resolves.toBe(0);

    const publicRsvpAfterCheckin = await createCheckinFixture(credentialService);
    const publicRsvpResponse = await startRequestBehindInvitationLock(
      publicRsvpAfterCheckin.invitation.id,
      () =>
        app.getHttpAdapter().getInstance().inject({
          headers: { origin: PUBLIC_ORIGIN },
          method: "PUT",
          payload: publicDeclinedPayload(1),
          url: `/api/public/invitations/${publicRsvpAfterCheckin.publicCredential}/rsvp`,
        }),
      async (tx) => {
        await tx.checkinRecord.create({
          data: {
            attendeeCount: 1,
            checkinPassId: publicRsvpAfterCheckin.checkinPassId,
            confirmedByAdminUserId: staffSession.user.id,
            eventId: publicRsvpAfterCheckin.event.id,
            invitationId: publicRsvpAfterCheckin.invitation.id,
            method: CheckinMethod.QR,
          },
        });
      },
    );

    expect(publicRsvpResponse.statusCode).toBe(409);
    expect(publicRsvpResponse.json().error.code).toBe(
      "RSVP_LOCKED_AFTER_CHECKIN",
    );

    const ownerOverrideAfterCheckin =
      await createCheckinFixture(credentialService);
    const ownerOverrideResponse = await startRequestBehindInvitationLock(
      ownerOverrideAfterCheckin.invitation.id,
      () =>
        app.getHttpAdapter().getInstance().inject({
          headers: unsafeHeaders(ownerSession),
          method: "PUT",
          payload: adminOverridePayload({
            eventId: ownerOverrideAfterCheckin.event.id,
            expectedVersion: 1,
            inviteeId: ownerOverrideAfterCheckin.invitee.id,
          }),
          url: `/api/admin/invitations/${ownerOverrideAfterCheckin.invitation.id}/rsvp`,
        }),
      async (tx) => {
        await tx.checkinRecord.create({
          data: {
            attendeeCount: 1,
            checkinPassId: null,
            confirmedByAdminUserId: staffSession.user.id,
            eventId: ownerOverrideAfterCheckin.event.id,
            invitationId: ownerOverrideAfterCheckin.invitation.id,
            method: CheckinMethod.MANUAL,
          },
        });
      },
    );

    expect(ownerOverrideResponse.statusCode).toBe(409);
    expect(ownerOverrideResponse.json().error.code).toBe(
      "RSVP_LOCKED_AFTER_CHECKIN",
    );

    const attendeeCountRace = await createCheckinFixture(credentialService, {
      expectedAttendeeCount: 2,
    });
    const attendeeCountRaceResponse = await startRequestBehindInvitationLock(
      attendeeCountRace.invitation.id,
      () =>
        qrConfirmRequest(app, {
          attendeeCount: 2,
          eventId: attendeeCountRace.event.id,
          qrPayload: attendeeCountRace.qrPayload,
          session: staffSession,
        }),
      async (tx) => {
        await tx.rSVPEventSelection.update({
          data: { expectedAttendeeCount: 1 },
          where: {
            rsvpId_eventId: {
              eventId: attendeeCountRace.event.id,
              rsvpId: attendeeCountRace.rsvp.id,
            },
          },
        });
      },
    );

    expect(attendeeCountRaceResponse.statusCode).toBe(422);
    expect(attendeeCountRaceResponse.json().error.code).toBe(
      "INVALID_ATTENDEE_COUNT",
    );
    await expect(
      prisma.checkinRecord.count({
        where: { invitationId: attendeeCountRace.invitation.id },
      }),
    ).resolves.toBe(0);
  });
});
