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
  CheckinPassStatus,
  InvitationStatus,
  InviteeCategory,
  PrismaClient,
  RSVPAttendeeType,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { CredentialService } from "../security/credential.service.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const PUBLIC_ORIGIN = "http://localhost:3000";
const OWNER_EMAIL = "owner-8d3@example.com";
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

async function createEvent(input: { displayOrder: number; isActive?: boolean }) {
  const suffix = randomUUID();

  return prisma.event.create({
    data: {
      displayOrder: input.displayOrder,
      isActive: input.isActive ?? true,
      name: `8D3 Event ${input.displayOrder}`,
      slug: `8d3-event-${input.displayOrder}-${suffix}`,
    },
  });
}

async function createInvitation(
  credentialService: CredentialService,
  input: {
    eventIds?: string[];
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
      displayName: `8D3 Household ${id}`,
      id,
      publicTokenHash: credentialService.hashCredential(publicCredential),
      publicTokenVersion: 1,
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
  invitationId: string;
  displayOrder: number;
  fullName?: string;
  category?: InviteeCategory;
  label?: string | null;
}) {
  return prisma.invitee.create({
    data: {
      category: input.category ?? InviteeCategory.ADULT,
      displayOrder: input.displayOrder,
      fullName: input.fullName ?? `Invitee ${input.displayOrder}`,
      invitationId: input.invitationId,
      label: input.label ?? null,
    },
  });
}

async function createAcceptedRsvp(input: {
  invitationId: string;
  inviteeId: string;
  eventId: string;
}) {
  return prisma.rSVP.create({
    data: {
      attendees: {
        create: {
          attendeeType: RSVPAttendeeType.NAMED_INVITEE,
          inviteeId: input.inviteeId,
          quantity: 1,
        },
      },
      checkinPasses: {
        create: {
          invitationId: input.invitationId,
          status: CheckinPassStatus.ACTIVE,
          tokenHash: `pass-${randomUUID()}`,
        },
      },
      eventSelections: {
        create: {
          attending: true,
          eventId: input.eventId,
          expectedAttendeeCount: 1,
        },
      },
      invitationId: input.invitationId,
      status: RSVPStatus.ACCEPTED,
      submittedAt: new Date("2026-10-01T01:00:00.000Z"),
    },
    include: {
      attendees: true,
      checkinPasses: true,
      eventSelections: true,
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

function acceptedPublicRsvpPayload(inviteeId: string, eventId: string) {
  return {
    attendees: [
      {
        inviteeId,
        quantity: 1,
        type: "NAMED_INVITEE",
      },
    ],
    dietaryNotes: null,
    eventSelections: [
      {
        attending: true,
        eventId,
        expectedAttendeeCount: 1,
      },
    ],
    expectedVersion: null,
    status: "ACCEPTED",
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

describe("admin invitee and eligibility HTTP integration", () => {
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

  it("enforces shared unsafe admin security on every 8D3 route", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const secondEvent = await createEvent({ displayOrder: 2 });
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const invitee = await createInvitee({
      displayOrder: 0,
      invitationId: invitation.id,
    });
    const routes = [
      {
        method: "POST",
        payload: { category: "ADULT", fullName: "New Guest", label: null },
        url: `/api/admin/invitations/${invitation.id}/invitees`,
      },
      {
        method: "PATCH",
        payload: {
          expectedUpdatedAt: invitee.updatedAt.toISOString(),
          fullName: "Edited Guest",
        },
        url: `/api/admin/invitees/${invitee.id}`,
      },
      {
        method: "DELETE",
        payload: undefined,
        url: `/api/admin/invitees/${invitee.id}`,
      },
      {
        method: "PUT",
        payload: { eventIds: [event.id, secondEvent.id] },
        url: `/api/admin/invitations/${invitation.id}/events`,
      },
    ] as const;

    for (const route of routes) {
      const missingSession = await app.getHttpAdapter().getInstance().inject({
        method: route.method,
        payload: route.payload,
        url: route.url,
      });
      const missingCsrf = await app.getHttpAdapter().getInstance().inject({
        headers: { cookie: session.cookie, origin: ADMIN_ORIGIN },
        method: route.method,
        payload: route.payload,
        url: route.url,
      });
      const wrongCsrf = await app.getHttpAdapter().getInstance().inject({
        headers: {
          cookie: session.cookie,
          origin: ADMIN_ORIGIN,
          "x-csrf-token": "wrong",
        },
        method: route.method,
        payload: route.payload,
        url: route.url,
      });
      const badOrigin = await app.getHttpAdapter().getInstance().inject({
        headers: {
          cookie: session.cookie,
          origin: "http://evil.example",
          "x-csrf-token": session.csrfToken,
        },
        method: route.method,
        payload: route.payload,
        url: route.url,
      });

      expect(missingSession.statusCode, route.url).toBe(401);
      expect(missingCsrf.statusCode, route.url).toBe(403);
      expect(wrongCsrf.statusCode, route.url).toBe(403);
      expect(badOrigin.statusCode, route.url).toBe(403);
    }

    const create = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: routes[0].payload,
      url: routes[0].url,
    });
    const update = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        expectedUpdatedAt: invitee.updatedAt.toISOString(),
        label: "edited",
      },
      url: routes[1].url,
    });
    const replace = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: routes[3].payload,
      url: routes[3].url,
    });
    const deletable = await createInvitee({
      displayOrder: 9,
      invitationId: invitation.id,
    });
    const remove = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "DELETE",
      url: `/api/admin/invitees/${deletable.id}`,
    });

    expect(create.statusCode).toBe(201);
    expect(update.statusCode).toBe(200);
    expect(replace.statusCode).toBe(200);
    expect(remove.statusCode).toBe(204);
  });

  it("creates invitees with server displayOrder allocation and validation", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const archived = await createInvitation(credentialService, {
      status: InvitationStatus.ARCHIVED,
    });
    await createInvitee({ displayOrder: 0, invitationId: invitation.id });
    await createInvitee({ displayOrder: 2, invitationId: invitation.id });
    const before = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });

    const created = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { category: "ADULT", fullName: "  Alex Guest  ", label: "  VIP " },
      url: `/api/admin/invitations/${invitation.id}/invitees`,
    });
    const duplicateName = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { category: "CHILD", fullName: "Alex Guest", label: "   " },
      url: `/api/admin/invitations/${invitation.id}/invitees`,
    });
    const emptyHousehold = await createInvitation(credentialService);
    const first = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { category: "ADULT", fullName: "First Guest" },
      url: `/api/admin/invitations/${emptyHousehold.invitation.id}/invitees`,
    });
    const invalids = [
      { category: "ADULT", fullName: "   " },
      { category: "TEEN", fullName: "Bad Category" },
      { category: "ADULT", displayOrder: 4, fullName: "Client Order" },
    ];

    for (const payload of invalids) {
      const response = await app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "POST",
        payload,
        url: `/api/admin/invitations/${invitation.id}/invitees`,
      });
      expect(response.statusCode).toBe(400);
    }

    const missing = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { category: "ADULT", fullName: "Missing Parent" },
      url: `/api/admin/invitations/${randomUUID()}/invitees`,
    });
    const archivedResponse = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { category: "ADULT", fullName: "Archived Parent" },
      url: `/api/admin/invitations/${archived.invitation.id}/invitees`,
    });
    const after = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      category: "ADULT",
      displayOrder: 3,
      fullName: "Alex Guest",
      invitationId: invitation.id,
      label: "VIP",
    });
    expect(duplicateName.statusCode).toBe(201);
    expect(duplicateName.json()).toMatchObject({
      category: "CHILD",
      displayOrder: 4,
      fullName: "Alex Guest",
      label: null,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().displayOrder).toBe(0);
    expect(missing.statusCode).toBe(404);
    expect(archivedResponse.statusCode).toBe(409);
    expect(after.publicTokenHash).toBe(before.publicTokenHash);
    expect(after.publicTokenVersion).toBe(before.publicTokenVersion);
    expect(after.openCount).toBe(before.openCount);
    expect(await prisma.rSVP.count()).toBe(0);
    expect(responseKeys(created.json())).not.toContain("publicTokenHash");
    expect(responseKeys(created.json())).not.toContain("qrPayload");
  });

  it("serializes concurrent invitee creates with distinct displayOrder values", async () => {
    const session = await createOwnerAndSession();
    const { invitation } = await createInvitation(credentialService);
    await createInvitee({ displayOrder: 2, invitationId: invitation.id });

    const [left, right] = await Promise.all([
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "POST",
        payload: { category: "ADULT", fullName: "Left" },
        url: `/api/admin/invitations/${invitation.id}/invitees`,
      }),
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "POST",
        payload: { category: "ADULT", fullName: "Right" },
        url: `/api/admin/invitations/${invitation.id}/invitees`,
      }),
    ]);
    const orders = [left.json().displayOrder, right.json().displayOrder].sort();

    expect(left.statusCode).toBe(201);
    expect(right.statusCode).toBe(201);
    expect(orders).toEqual([3, 4]);
    expect(await prisma.invitee.count({ where: { invitationId: invitation.id } })).toBe(3);
  });

  it("updates invitees with optimistic concurrency and preserves RSVP snapshots", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const invitee = await createInvitee({
      category: InviteeCategory.ADULT,
      displayOrder: 0,
      fullName: "Original Name",
      invitationId: invitation.id,
      label: "Original",
    });
    const rsvp = await createAcceptedRsvp({
      eventId: event.id,
      invitationId: invitation.id,
      inviteeId: invitee.id,
    });
    const beforeInvitation = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });

    const updated = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        category: "CHILD",
        expectedUpdatedAt: invitee.updatedAt.toISOString(),
        fullName: "  Updated Name ",
        label: "",
      },
      url: `/api/admin/invitees/${invitee.id}`,
    });
    const stale = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        expectedUpdatedAt: invitee.updatedAt.toISOString(),
        fullName: "Stale Name",
      },
      url: `/api/admin/invitees/${invitee.id}`,
    });
    const immutable = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        displayOrder: 99,
        expectedUpdatedAt: updated.json().updatedAt,
      },
      url: `/api/admin/invitees/${invitee.id}`,
    });
    const [afterInvitee, afterRsvp, afterPass, afterInvitation] =
      await Promise.all([
        prisma.invitee.findUniqueOrThrow({ where: { id: invitee.id } }),
        prisma.rSVP.findUniqueOrThrow({
          include: { attendees: true },
          where: { id: rsvp.id },
        }),
        prisma.checkinPass.findFirstOrThrow({ where: { rsvpId: rsvp.id } }),
        prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } }),
      ]);
    const missing = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        expectedUpdatedAt: invitee.updatedAt.toISOString(),
        fullName: "Missing",
      },
      url: `/api/admin/invitees/${randomUUID()}`,
    });
    const archivedInvitation = await createInvitation(credentialService, {
      status: InvitationStatus.ARCHIVED,
    });
    const archivedInvitee = await createInvitee({
      displayOrder: 0,
      invitationId: archivedInvitation.invitation.id,
    });
    const archived = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        expectedUpdatedAt: archivedInvitee.updatedAt.toISOString(),
        fullName: "Archived",
      },
      url: `/api/admin/invitees/${archivedInvitee.id}`,
    });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      category: "CHILD",
      fullName: "Updated Name",
      label: null,
    });
    expect(Date.parse(updated.json().updatedAt)).toBeGreaterThan(
      Date.parse(invitee.updatedAt.toISOString()),
    );
    expect(stale.statusCode).toBe(409);
    expect(immutable.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(archived.statusCode).toBe(409);
    expect(afterInvitee.fullName).toBe("Updated Name");
    expect(afterRsvp.version).toBe(1);
    expect(afterRsvp.attendees).toEqual(rsvp.attendees);
    expect(afterPass.tokenHash).toBe(rsvp.checkinPasses[0]!.tokenHash);
    expect(afterInvitation.publicTokenHash).toBe(beforeInvitation.publicTokenHash);
    expect(afterInvitation.openCount).toBe(beforeInvitation.openCount);
  });

  it("serializes concurrent invitee updates with one success and one conflict", async () => {
    const session = await createOwnerAndSession();
    const { invitation } = await createInvitation(credentialService);
    const invitee = await createInvitee({
      displayOrder: 0,
      invitationId: invitation.id,
    });

    const [left, right] = await Promise.all([
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: {
          expectedUpdatedAt: invitee.updatedAt.toISOString(),
          fullName: "Left",
        },
        url: `/api/admin/invitees/${invitee.id}`,
      }),
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: {
          expectedUpdatedAt: invitee.updatedAt.toISOString(),
          fullName: "Right",
        },
        url: `/api/admin/invitees/${invitee.id}`,
      }),
    ]);
    const after = await prisma.invitee.findUniqueOrThrow({
      where: { id: invitee.id },
    });

    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    expect(["Left", "Right"]).toContain(after.fullName);
  });

  it("deletes only unreferenced invitees and is retry-safe", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const kept = await createInvitee({ displayOrder: 0, invitationId: invitation.id });
    const deleted = await createInvitee({
      displayOrder: 1,
      invitationId: invitation.id,
    });
    const referenced = await createInvitee({
      displayOrder: 2,
      invitationId: invitation.id,
    });
    const rsvp = await createAcceptedRsvp({
      eventId: event.id,
      invitationId: invitation.id,
      inviteeId: referenced.id,
    });

    const first = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "DELETE",
      url: `/api/admin/invitees/${deleted.id}`,
    });
    const repeat = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "DELETE",
      url: `/api/admin/invitees/${deleted.id}`,
    });
    const missing = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "DELETE",
      url: `/api/admin/invitees/${randomUUID()}`,
    });
    const malformed = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "DELETE",
      url: "/api/admin/invitees/not-a-uuid",
    });
    const referencedResponse = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "DELETE",
      url: `/api/admin/invitees/${referenced.id}`,
    });
    const archivedInvitation = await createInvitation(credentialService, {
      status: InvitationStatus.ARCHIVED,
    });
    const archivedInvitee = await createInvitee({
      displayOrder: 0,
      invitationId: archivedInvitation.invitation.id,
    });
    const archived = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "DELETE",
      url: `/api/admin/invitees/${archivedInvitee.id}`,
    });
    const remaining = await prisma.invitee.findMany({
      orderBy: { displayOrder: "asc" },
      where: { invitationId: invitation.id },
    });
    const afterRsvp = await prisma.rSVP.findUniqueOrThrow({
      include: { attendees: true, eventSelections: true },
      where: { id: rsvp.id },
    });

    expect(first.statusCode).toBe(204);
    expect(repeat.statusCode).toBe(204);
    expect(missing.statusCode).toBe(204);
    expect(malformed.statusCode).toBe(400);
    expect(referencedResponse.statusCode).toBe(409);
    expect(archived.statusCode).toBe(409);
    expect(remaining.map((item) => item.id)).toEqual([kept.id, referenced.id]);
    expect(remaining.map((item) => item.displayOrder)).toEqual([0, 2]);
    expect(afterRsvp.attendees).toEqual(rsvp.attendees);
    expect(afterRsvp.eventSelections).toEqual(rsvp.eventSelections);
  });

  it("preserves the delete versus public RSVP reference invariant", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const { invitation, publicCredential } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const invitee = await createInvitee({
      displayOrder: 0,
      invitationId: invitation.id,
    });

    const [remove, rsvp] = await Promise.all([
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "DELETE",
        url: `/api/admin/invitees/${invitee.id}`,
      }),
      app.getHttpAdapter().getInstance().inject({
        method: "PUT",
        payload: acceptedPublicRsvpPayload(invitee.id, event.id),
        url: `/api/public/invitations/${publicCredential}/rsvp`,
      }),
    ]);
    const inviteeAfter = await prisma.invitee.findUnique({
      where: { id: invitee.id },
    });
    const attendeeAfter = await prisma.rSVPAttendee.findFirst({
      where: { inviteeId: invitee.id },
    });

    expect([204, 409]).toContain(remove.statusCode);
    expect([200, 422]).toContain(rsvp.statusCode);
    if (inviteeAfter === null) {
      expect(attendeeAfter).toBeNull();
    } else {
      expect(attendeeAfter?.inviteeId).toBe(invitee.id);
    }
  });

  it("replaces eligibility declaratively with referential safety", async () => {
    const session = await createOwnerAndSession();
    const first = await createEvent({ displayOrder: 1 });
    const second = await createEvent({ displayOrder: 2 });
    const third = await createEvent({ displayOrder: 3 });
    const inactive = await createEvent({ displayOrder: 4, isActive: false });
    const inactiveExisting = await createEvent({ displayOrder: 5, isActive: false });
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [first.id, inactiveExisting.id],
    });

    const replace = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: { eventIds: [second.id, third.id, inactiveExisting.id] },
      url: `/api/admin/invitations/${invitation.id}/events`,
    });
    const repeat = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: { eventIds: [second.id, third.id, inactiveExisting.id] },
      url: `/api/admin/invitations/${invitation.id}/events`,
    });
    const duplicate = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: { eventIds: [second.id, second.id] },
      url: `/api/admin/invitations/${invitation.id}/events`,
    });
    const missing = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: { eventIds: [randomUUID()] },
      url: `/api/admin/invitations/${invitation.id}/events`,
    });
    const inactiveNew = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: { eventIds: [inactive.id] },
      url: `/api/admin/invitations/${invitation.id}/events`,
    });
    const archivedInvitation = await createInvitation(credentialService, {
      status: InvitationStatus.ARCHIVED,
    });
    const archived = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: { eventIds: [first.id] },
      url: `/api/admin/invitations/${archivedInvitation.invitation.id}/events`,
    });
    const notFound = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: { eventIds: [first.id] },
      url: `/api/admin/invitations/${randomUUID()}/events`,
    });

    expect(replace.statusCode).toBe(200);
    expect(replace.json().eligibility.map((item: { event: { id: string } }) => item.event.id)).toEqual([
      second.id,
      third.id,
      inactiveExisting.id,
    ]);
    expect(repeat.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(400);
    expect(missing.statusCode).toBe(400);
    expect(inactiveNew.statusCode).toBe(400);
    expect(archived.statusCode).toBe(409);
    expect(notFound.statusCode).toBe(404);
  });

  it("rejects referenced eligibility removal atomically", async () => {
    const session = await createOwnerAndSession();
    const first = await createEvent({ displayOrder: 1 });
    const second = await createEvent({ displayOrder: 2 });
    const third = await createEvent({ displayOrder: 3 });
    const { invitation } = await createInvitation(credentialService, {
      eventIds: [first.id, second.id],
    });
    const invitee = await createInvitee({
      displayOrder: 0,
      invitationId: invitation.id,
    });
    const rsvp = await createAcceptedRsvp({
      eventId: first.id,
      invitationId: invitation.id,
      inviteeId: invitee.id,
    });

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PUT",
      payload: { eventIds: [second.id, third.id] },
      url: `/api/admin/invitations/${invitation.id}/events`,
    });
    const [eligibility, selections, pass, afterRsvp] = await Promise.all([
      prisma.invitationEvent.findMany({
        orderBy: { eventId: "asc" },
        where: { invitationId: invitation.id },
      }),
      prisma.rSVPEventSelection.findMany({ where: { rsvpId: rsvp.id } }),
      prisma.checkinPass.findFirstOrThrow({ where: { rsvpId: rsvp.id } }),
      prisma.rSVP.findUniqueOrThrow({ where: { id: rsvp.id } }),
    ]);

    expect(response.statusCode).toBe(409);
    expect(eligibility.map((item) => item.eventId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(selections).toEqual(rsvp.eventSelections);
    expect(afterRsvp.version).toBe(rsvp.version);
    expect(pass.tokenHash).toBe(rsvp.checkinPasses[0]!.tokenHash);
  });

  it("preserves the eligibility versus public RSVP invariant", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const { invitation, publicCredential } = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const invitee = await createInvitee({
      displayOrder: 0,
      invitationId: invitation.id,
    });

    const [replace, rsvp] = await Promise.all([
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "PUT",
        payload: { eventIds: [] },
        url: `/api/admin/invitations/${invitation.id}/events`,
      }),
      app.getHttpAdapter().getInstance().inject({
        method: "PUT",
        payload: acceptedPublicRsvpPayload(invitee.id, event.id),
        url: `/api/public/invitations/${publicCredential}/rsvp`,
      }),
    ]);
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

    expect([200, 409]).toContain(replace.statusCode);
    expect([200, 422]).toContain(rsvp.statusCode);
    if (selection !== null) {
      expect(eligibility).not.toBeNull();
      expect(replace.statusCode).toBe(409);
    }
    if (eligibility === null) {
      expect(selection).toBeNull();
    }
  });
});
