import "reflect-metadata";
import { randomUUID } from "node:crypto";
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
  InvitationStatus,
  InviteeCategory,
  PrismaClient,
  RSVPAttendeeType,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { CredentialService } from "../security/credential.service.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const PUBLIC_ORIGIN = "http://localhost:3000";
const OWNER_EMAIL = "owner-8d4@example.com";
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

async function createOwnerAndSession() {
  const owner = await prisma.adminUser.create({
    data: {
      email: OWNER_EMAIL,
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

async function createEvent(displayOrder: number) {
  const suffix = randomUUID();

  return prisma.event.create({
    data: {
      displayOrder,
      name: `8D4 Event ${displayOrder}`,
      slug: `8d4-event-${displayOrder}-${suffix}`,
    },
  });
}

async function createInvitation(
  credentialService: CredentialService,
  input: {
    displayName?: string;
    eventIds?: string[];
    greetingName?: string | null;
    rsvpDeadlineAt?: Date | null;
    status?: InvitationStatus;
  } = {},
) {
  const id = randomUUID();
  const publicCredential = credentialService.deriveCredential({
    namespace: "invitation",
    stableId: id,
    version: 1,
  });
  const invitation = await prisma.invitation.create({
    data: {
      archivedAt:
        input.status === InvitationStatus.ARCHIVED
          ? new Date("2026-10-01T01:00:00.000Z")
          : null,
      displayName: input.displayName ?? `8D4 Household ${id}`,
      greetingName: input.greetingName ?? null,
      id,
      publicTokenHash: credentialService.hashCredential(publicCredential),
      publicTokenVersion: 1,
      rsvpDeadlineAt: input.rsvpDeadlineAt ?? null,
      status: input.status ?? InvitationStatus.ACTIVE,
    },
  });

  if (input.eventIds !== undefined) {
    await prisma.invitationEvent.createMany({
      data: input.eventIds.map((eventId) => ({
        eventId,
        invitationId: invitation.id,
      })),
    });
  }

  return { invitation, publicCredential };
}

async function createInvitee(input: {
  displayOrder: number;
  fullName: string;
  invitationId: string;
  category?: InviteeCategory;
}) {
  return prisma.invitee.create({
    data: {
      category: input.category ?? InviteeCategory.ADULT,
      displayOrder: input.displayOrder,
      fullName: input.fullName,
      invitationId: input.invitationId,
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

function acceptedPayload(input: {
  eventId: string;
  expectedVersion: number | null;
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
    dietaryNotes: "No seafood",
    eventSelections: [
      {
        attending: true,
        eventId: input.eventId,
        expectedAttendeeCount: 1,
      },
    ],
    expectedVersion: input.expectedVersion,
    overrideReason: "Guest replied by phone",
    status: "ACCEPTED",
  };
}

function publicAcceptedPayload(input: {
  eventId: string;
  expectedVersion: number | null;
  inviteeId: string;
}) {
  const payload = acceptedPayload(input);

  return {
    attendees: payload.attendees,
    dietaryNotes: payload.dietaryNotes,
    eventSelections: payload.eventSelections,
    expectedVersion: payload.expectedVersion,
    status: payload.status,
  };
}

function declinedPayload(expectedVersion: number | null) {
  return {
    attendees: [],
    dietaryNotes: "Ignored on decline",
    eventSelections: [],
    expectedVersion,
    overrideReason: "Guest cancelled by phone",
    status: "DECLINED",
  };
}

function responseKeys(value: unknown): string[] {
  const keys = new Set<string>();

  function visit(input: unknown): void {
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }

    if (typeof input !== "object" || input === null) {
      return;
    }

    for (const [key, nested] of Object.entries(input)) {
      keys.add(key);
      visit(nested);
    }
  }

  visit(value);

  return [...keys].sort();
}

describe("admin RSVP HTTP integration", () => {
  let app: NestFastifyApplication;
  let credentialService: CredentialService;

  beforeAll(async () => {
    process.env.ADMIN_ORIGIN = ADMIN_ORIGIN;
    process.env.CREDENTIAL_SECRET = CREDENTIAL_SECRET;
    process.env.NODE_ENV = "test";
    process.env.PUBLIC_INVITATION_BASE_URL = PUBLIC_ORIGIN;

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
    process.env.PUBLIC_INVITATION_BASE_URL = PUBLIC_ORIGIN;
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await app.close();
    await prisma.$disconnect();
  });

  it("enforces admin security for 8D4 routes", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent(1);
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const invitee = await createInvitee({
      displayOrder: 0,
      fullName: "Security Guest",
      invitationId: invitation.id,
    });
    const create = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: acceptedPayload({
        eventId: event.id,
        expectedVersion: null,
        inviteeId: invitee.id,
      }),
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });
    const rsvpId = create.json().rsvp.id as string;

    for (const url of ["/api/admin/rsvps", `/api/admin/rsvps/${rsvpId}`]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            headers: { cookie: session.cookie },
            method: "GET",
            url,
          })
        ).statusCode,
      ).toBe(200);
    }

    const overrideUrl = `/api/admin/invitations/${invitation.id}/rsvp`;
    const payload = declinedPayload(1);

    expect(
      (await app.inject({ method: "PUT", payload, url: overrideUrl })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          headers: { cookie: session.cookie, origin: ADMIN_ORIGIN },
          method: "PUT",
          payload,
          url: overrideUrl,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: {
            cookie: session.cookie,
            origin: ADMIN_ORIGIN,
            "x-csrf-token": "wrong",
          },
          method: "PUT",
          payload,
          url: overrideUrl,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: {
            cookie: session.cookie,
            origin: "http://evil.example",
            "x-csrf-token": session.csrfToken,
          },
          method: "PUT",
          payload,
          url: overrideUrl,
        })
      ).statusCode,
    ).toBe(403);
  });

  it("lists persisted RSVPs with filters, counts, de-duplication, and privacy", async () => {
    const session = await createOwnerAndSession();
    const firstEvent = await createEvent(1);
    const secondEvent = await createEvent(2);
    const empty = await app.inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: "/api/admin/rsvps",
    });

    expect(empty.json()).toMatchObject({
      items: [],
      page: { number: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    });

    const { invitation } = await createInvitation(credentialService, {
      displayName: "Smith Household",
      eventIds: [firstEvent.id, secondEvent.id],
      greetingName: "The Smiths",
      status: InvitationStatus.ARCHIVED,
    });
    const invitee = await createInvitee({
      displayOrder: 0,
      fullName: "Jane Smith",
      invitationId: invitation.id,
    });
    await createInvitee({
      displayOrder: 1,
      fullName: "John Smith",
      invitationId: invitation.id,
    });
    await prisma.rSVP.create({
      data: {
        attendees: {
          // Count contract: list attendeeCount is SUM(quantity), not row count.
          create: [
            {
              attendeeType: RSVPAttendeeType.NAMED_INVITEE,
              inviteeId: invitee.id,
              quantity: 1,
            },
            {
              attendeeType: RSVPAttendeeType.ADDITIONAL_CHILD,
              quantity: 3,
            },
          ],
        },
        dietaryNotes: "Private food note",
        eventSelections: {
          // Count contract: list attendingEventCount counts only attending=true rows.
          create: [
            {
              attending: true,
              eventId: firstEvent.id,
              expectedAttendeeCount: 2,
            },
            {
              attending: false,
              eventId: secondEvent.id,
              expectedAttendeeCount: 0,
            },
          ],
        },
        guestNote: "Private guest note",
        invitationId: invitation.id,
        status: RSVPStatus.ACCEPTED,
        submittedAt: new Date("2026-10-01T01:00:00.000Z"),
      },
    });

    const list = await app.inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/rsvps?status=ACCEPTED&eventId=${firstEvent.id}&search=smith&pageSize=100`,
    });
    const body = list.json();

    expect(list.statusCode).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.page.totalItems).toBe(1);
    expect(body.items[0]).toMatchObject({
      attendeeCount: 4,
      attendingEventCount: 1,
      invitation: {
        displayName: "Smith Household",
        status: "ARCHIVED",
      },
      status: "ACCEPTED",
      submittedByAdmin: false,
    });
    expect(responseKeys(body)).not.toContain("dietaryNotes");
    expect(responseKeys(body)).not.toContain("guestNote");
    expect(responseKeys(body)).not.toContain("overrideReason");
    expect(responseKeys(body)).not.toContain("qrPayload");
    expect(responseKeys(body)).not.toContain("tokenHash");
    expect(responseKeys(body)).not.toContain("publicTokenHash");

    expect(
      (
        await app.inject({
          headers: { cookie: session.cookie },
          method: "GET",
          url: "/api/admin/rsvps?pageSize=101",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          headers: { cookie: session.cookie },
          method: "GET",
          url: "/api/admin/rsvps?sortBy=displayName",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          headers: { cookie: session.cookie },
          method: "GET",
          url: `/api/admin/rsvps?search=${"a".repeat(101)}`,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("returns safe RSVP detail and admin attribution", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent(1);
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const invitee = await createInvitee({
      displayOrder: 0,
      fullName: "Detail Guest",
      invitationId: invitation.id,
    });
    const created = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: acceptedPayload({
        eventId: event.id,
        expectedVersion: null,
        inviteeId: invitee.id,
      }),
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });
    const body = created.json();

    expect(created.statusCode).toBe(200);
    expect(body.rsvp).toMatchObject({
      dietaryNotes: "No seafood",
      guestNote: null,
      overrideReason: "Guest replied by phone",
      submittedByAdmin: true,
      adminUser: { email: OWNER_EMAIL, id: session.owner.id },
    });
    expect(body.rsvp.attendees).toHaveLength(1);
    expect(body.rsvp.eventSelections[0]).toMatchObject({
      attending: true,
      expectedAttendeeCount: 1,
    });
    expect(body.rsvp.checkinPasses[0]).toMatchObject({
      credentialVersion: 1,
      status: "ACTIVE",
    });
    expect(responseKeys(body)).not.toContain("qrPayload");
    expect(responseKeys(body)).not.toContain("tokenHash");
    expect(responseKeys(body)).not.toContain("publicTokenHash");
    expect(responseKeys(body)).not.toContain("passwordHash");
    expect(responseKeys(body)).not.toContain("sessionTokenHash");

    const detail = await app.inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/rsvps/${body.rsvp.id}`,
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(body);
    expect(
      (
        await app.inject({
          headers: { cookie: session.cookie },
          method: "GET",
          url: `/api/admin/rsvps/${randomUUID()}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          headers: { cookie: session.cookie },
          method: "GET",
          url: "/api/admin/rsvps/not-a-uuid",
        })
      ).statusCode,
    ).toBe(400);
  });

  it("clears current admin attribution after a successful public RSVP and preserves it on failed public mutations", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent(1);
    const alternateEvent = await createEvent(2);
    const { invitation, publicCredential } = await createInvitation(
      credentialService,
      {
        eventIds: [event.id],
      },
    );
    const invitee = await createInvitee({
      displayOrder: 0,
      fullName: "Attribution Guest",
      invitationId: invitation.id,
    });

    const ownerOverride = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: acceptedPayload({
        eventId: event.id,
        expectedVersion: null,
        inviteeId: invitee.id,
      }),
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });
    const ownerBody = ownerOverride.json();

    expect(ownerOverride.statusCode).toBe(200);
    expect(ownerBody.rsvp).toMatchObject({
      overrideReason: "Guest replied by phone",
      submittedByAdmin: true,
      version: 1,
    });

    const afterOwner = await prisma.rSVP.update({
      data: { guestNote: "Public update must preserve this" },
      include: { checkinPasses: true },
      where: { invitationId: invitation.id },
    });
    expect(afterOwner.submittedByAdminUserId).toBe(session.owner.id);
    expect(afterOwner.adminOverrideReason).toBe("Guest replied by phone");
    expect(
      afterOwner.checkinPasses.filter((pass) => pass.status === "ACTIVE"),
    ).toHaveLength(1);

    const stalePublic = await app.inject({
      method: "PUT",
      payload: publicAcceptedPayload({
        eventId: event.id,
        expectedVersion: null,
        inviteeId: invitee.id,
      }),
      url: `/api/public/invitations/${publicCredential}/rsvp`,
    });
    expect(stalePublic.statusCode).toBe(409);
    expect(stalePublic.json()).toMatchObject({
      error: { code: "RSVP_VERSION_CONFLICT" },
    });

    const afterStale = await prisma.rSVP.findUniqueOrThrow({
      include: { checkinPasses: true },
      where: { invitationId: invitation.id },
    });
    expect(afterStale.version).toBe(1);
    expect(afterStale.submittedByAdminUserId).toBe(session.owner.id);
    expect(afterStale.adminOverrideReason).toBe("Guest replied by phone");
    expect(
      afterStale.checkinPasses.filter((pass) => pass.status === "ACTIVE"),
    ).toHaveLength(1);

    const invalidEligibility = await app.inject({
      method: "PUT",
      payload: publicAcceptedPayload({
        eventId: alternateEvent.id,
        expectedVersion: 1,
        inviteeId: invitee.id,
      }),
      url: `/api/public/invitations/${publicCredential}/rsvp`,
    });
    expect(invalidEligibility.statusCode).toBe(422);

    const afterInvalid = await prisma.rSVP.findUniqueOrThrow({
      include: { checkinPasses: true },
      where: { invitationId: invitation.id },
    });
    expect(afterInvalid.version).toBe(1);
    expect(afterInvalid.submittedByAdminUserId).toBe(session.owner.id);
    expect(afterInvalid.adminOverrideReason).toBe("Guest replied by phone");
    expect(
      afterInvalid.checkinPasses.filter((pass) => pass.status === "ACTIVE"),
    ).toHaveLength(1);

    const publicUpdate = await app.inject({
      method: "PUT",
      payload: publicAcceptedPayload({
        eventId: event.id,
        expectedVersion: 1,
        inviteeId: invitee.id,
      }),
      url: `/api/public/invitations/${publicCredential}/rsvp`,
    });
    expect(publicUpdate.statusCode).toBe(200);
    expect(publicUpdate.json().rsvp.version).toBe(2);
    expect(publicUpdate.json().checkinPass.qrPayload).toEqual(expect.any(String));

    const afterPublic = await prisma.rSVP.findUniqueOrThrow({
      include: { checkinPasses: true },
      where: { invitationId: invitation.id },
    });
    expect(afterPublic.version).toBe(2);
    expect(afterPublic.guestNote).toBe("Public update must preserve this");
    expect(afterPublic.submittedByAdminUserId).toBeNull();
    expect(afterPublic.adminOverrideReason).toBeNull();
    expect(
      afterPublic.checkinPasses.filter((pass) => pass.status === "ACTIVE"),
    ).toHaveLength(1);

    const clearedDetail = await app.inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/rsvps/${ownerBody.rsvp.id}`,
    });
    expect(clearedDetail.statusCode).toBe(200);
    expect(clearedDetail.json().rsvp).toMatchObject({
      submittedByAdmin: false,
      version: 2,
    });
    expect(clearedDetail.json().rsvp.adminUser).toBeUndefined();
    expect(clearedDetail.json().rsvp.overrideReason).toBeUndefined();

    const laterOwnerOverride = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: {
        ...acceptedPayload({
          eventId: event.id,
          expectedVersion: 2,
          inviteeId: invitee.id,
        }),
        overrideReason: "Guest called again",
      },
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });
    expect(laterOwnerOverride.statusCode).toBe(200);
    expect(laterOwnerOverride.json().rsvp).toMatchObject({
      overrideReason: "Guest called again",
      submittedByAdmin: true,
      version: 3,
    });
  });

  it("overrides RSVP after the public deadline without bypassing other rules", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent(1);
    const { invitation, publicCredential } = await createInvitation(
      credentialService,
      {
        eventIds: [event.id],
        rsvpDeadlineAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    );
    const invitee = await createInvitee({
      displayOrder: 0,
      fullName: "Deadline Guest",
      invitationId: invitation.id,
    });

    const publicAttempt = await app.inject({
      method: "PUT",
      payload: {
        ...acceptedPayload({
          eventId: event.id,
          expectedVersion: null,
          inviteeId: invitee.id,
        }),
        overrideReason: undefined,
      },
      url: `/api/public/invitations/${publicCredential}/rsvp`,
    });
    expect(publicAttempt.statusCode).toBe(422);

    const adminAttempt = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: acceptedPayload({
        eventId: event.id,
        expectedVersion: null,
        inviteeId: invitee.id,
      }),
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });

    expect(adminAttempt.statusCode).toBe(200);
    expect(adminAttempt.json().rsvp.version).toBe(1);

    for (const payload of [
      { ...acceptedPayload({ eventId: event.id, expectedVersion: 1, inviteeId: invitee.id }), overrideReason: "" },
      { ...acceptedPayload({ eventId: event.id, expectedVersion: 1, inviteeId: invitee.id }), overrideReason: "a".repeat(501) },
      { ...acceptedPayload({ eventId: event.id, expectedVersion: 1, inviteeId: invitee.id }), guestNote: "not writable" },
      { ...acceptedPayload({ eventId: randomUUID(), expectedVersion: 1, inviteeId: invitee.id }) },
    ]) {
      const failed = await app.inject({
        headers: ownerHeaders(session),
        method: "PUT",
        payload,
        url: `/api/admin/invitations/${invitation.id}/rsvp`,
      });
      expect([400, 422]).toContain(failed.statusCode);
    }

    const after = await prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: invitation.id },
      include: { attendees: true, checkinPasses: true, eventSelections: true },
    });
    expect(after.version).toBe(1);
    expect(after.submittedByAdminUserId).toBe(session.owner.id);
    expect(after.adminOverrideReason).toBe("Guest replied by phone");
    expect(after.guestNote).toBeNull();
    expect(after.checkinPasses.filter((pass) => pass.status === "ACTIVE")).toHaveLength(1);
  });

  it("preserves canonical versioning, guestNote, and CheckinPass transitions", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent(1);
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const invitee = await createInvitee({
      displayOrder: 0,
      fullName: "Version Guest",
      invitationId: invitation.id,
    });
    const accepted = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: acceptedPayload({
        eventId: event.id,
        expectedVersion: null,
        inviteeId: invitee.id,
      }),
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });
    const rsvpId = accepted.json().rsvp.id as string;
    await prisma.rSVP.update({
      data: { guestNote: "Do not overwrite" },
      where: { id: rsvpId },
    });
    const stale = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: declinedPayload(1),
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });
    expect(stale.statusCode).toBe(200);

    const staleRetry = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: acceptedPayload({
        eventId: event.id,
        expectedVersion: 1,
        inviteeId: invitee.id,
      }),
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });
    expect(staleRetry.statusCode).toBe(409);

    const declined = await prisma.rSVP.findUniqueOrThrow({
      where: { id: rsvpId },
      include: { attendees: true, checkinPasses: true, eventSelections: true },
    });
    expect(declined.version).toBe(2);
    expect(declined.guestNote).toBe("Do not overwrite");
    expect(declined.dietaryNotes).toBeNull();
    expect(declined.attendees).toHaveLength(0);
    expect(declined.eventSelections).toHaveLength(0);
    expect(declined.checkinPasses.filter((pass) => pass.status === "ACTIVE")).toHaveLength(0);
    expect(declined.checkinPasses.filter((pass) => pass.status === "REVOKED")).toHaveLength(1);

    const reaccepted = await app.inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: acceptedPayload({
        eventId: event.id,
        expectedVersion: 2,
        inviteeId: invitee.id,
      }),
      url: `/api/admin/invitations/${invitation.id}/rsvp`,
    });
    expect(reaccepted.statusCode).toBe(200);
    const final = await prisma.rSVP.findUniqueOrThrow({
      where: { id: rsvpId },
      include: { checkinPasses: true },
    });
    expect(final.version).toBe(3);
    expect(final.guestNote).toBe("Do not overwrite");
    expect(final.checkinPasses.filter((pass) => pass.status === "ACTIVE")).toHaveLength(1);
    expect(final.checkinPasses.filter((pass) => pass.status === "REVOKED")).toHaveLength(1);
  });

  it("serializes OWNER/public/eligibility/invitee races through the Invitation lock", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent(1);
    const { invitation, publicCredential } = await createInvitation(
      credentialService,
      { eventIds: [event.id] },
    );
    const invitee = await createInvitee({
      displayOrder: 0,
      fullName: "Race Guest",
      invitationId: invitation.id,
    });
    const payload = acceptedPayload({
      eventId: event.id,
      expectedVersion: null,
      inviteeId: invitee.id,
    });
    const [ownerLeft, ownerRight] = await Promise.all([
      app.inject({
        headers: ownerHeaders(session),
        method: "PUT",
        payload,
        url: `/api/admin/invitations/${invitation.id}/rsvp`,
      }),
      app.inject({
        headers: ownerHeaders(session),
        method: "PUT",
        payload: { ...payload, overrideReason: "Second call" },
        url: `/api/admin/invitations/${invitation.id}/rsvp`,
      }),
    ]);
    expect([ownerLeft.statusCode, ownerRight.statusCode].sort()).toEqual([200, 409]);

    const existing = await prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: invitation.id },
    });
    const publicPayload = {
      ...acceptedPayload({
        eventId: event.id,
        expectedVersion: existing.version,
        inviteeId: invitee.id,
      }),
      overrideReason: undefined,
    };
    const [publicUpdate, ownerUpdate] = await Promise.all([
      app.inject({
        method: "PUT",
        payload: publicPayload,
        url: `/api/public/invitations/${publicCredential}/rsvp`,
      }),
      app.inject({
        headers: ownerHeaders(session),
        method: "PUT",
        payload: {
          ...acceptedPayload({
            eventId: event.id,
            expectedVersion: existing.version,
            inviteeId: invitee.id,
          }),
          overrideReason: "Concurrent owner update",
        },
        url: `/api/admin/invitations/${invitation.id}/rsvp`,
      }),
    ]);
    expect([publicUpdate.statusCode, ownerUpdate.statusCode].sort()).toEqual([
      200,
      409,
    ]);

    const current = await prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: invitation.id },
    });
    const [eligibilityUpdate, ownerWithSelection] = await Promise.all([
      app.inject({
        headers: ownerHeaders(session),
        method: "PUT",
        payload: { eventIds: [] },
        url: `/api/admin/invitations/${invitation.id}/events`,
      }),
      app.inject({
        headers: ownerHeaders(session),
        method: "PUT",
        payload: acceptedPayload({
          eventId: event.id,
          expectedVersion: current.version,
          inviteeId: invitee.id,
        }),
        url: `/api/admin/invitations/${invitation.id}/rsvp`,
      }),
    ]);
    expect([eligibilityUpdate.statusCode, ownerWithSelection.statusCode]).toEqual(
      expect.arrayContaining([409]),
    );
    const selection = await prisma.rSVPEventSelection.findFirst({
      where: { eventId: event.id, rsvp: { invitationId: invitation.id } },
    });
    const eligibility = await prisma.invitationEvent.findUnique({
      where: {
        invitationId_eventId: {
          eventId: event.id,
          invitationId: invitation.id,
        },
      },
    });
    expect(selection === null || eligibility !== null).toBe(true);

    const latest = await prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: invitation.id },
    });
    const [deleteInvitee, ownerWithInvitee] = await Promise.all([
      app.inject({
        headers: ownerHeaders(session),
        method: "DELETE",
        url: `/api/admin/invitees/${invitee.id}`,
      }),
      app.inject({
        headers: ownerHeaders(session),
        method: "PUT",
        payload: acceptedPayload({
          eventId: event.id,
          expectedVersion: latest.version,
          inviteeId: invitee.id,
        }),
        url: `/api/admin/invitations/${invitation.id}/rsvp`,
      }),
    ]);
    expect([deleteInvitee.statusCode, ownerWithInvitee.statusCode]).toEqual(
      expect.arrayContaining([409]),
    );
    const attendee = await prisma.rSVPAttendee.findFirst({
      where: { inviteeId: invitee.id, rsvp: { invitationId: invitation.id } },
    });
    const storedInvitee = await prisma.invitee.findUnique({
      where: { id: invitee.id },
    });
    expect(attendee === null || storedInvitee !== null).toBe(true);
  });
});
