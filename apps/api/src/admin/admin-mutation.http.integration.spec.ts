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
  PrismaClient,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { CredentialService } from "../security/credential.service.js";
import type { DerivedCredential } from "../security/credential.types.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const PUBLIC_ORIGIN = "http://localhost:3000";
const OWNER_EMAIL = "owner-mutation@example.com";
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

async function createEvent(input: {
  displayOrder: number;
  isActive?: boolean;
  name?: string;
  slug?: string;
}) {
  const suffix = randomUUID();

  return prisma.event.create({
    data: {
      displayOrder: input.displayOrder,
      isActive: input.isActive ?? true,
      name: input.name ?? `Event ${input.displayOrder}`,
      slug: input.slug ?? `event-${input.displayOrder}-${suffix}`,
    },
  });
}

async function createInvitation(
  credentialService: CredentialService,
  input: {
    displayName?: string;
    eventIds?: string[];
    openCount?: number;
    rsvp?: RSVPStatus;
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
      displayName: input.displayName ?? `Mutation Household ${id}`,
      id,
      lastOpenedAt:
        input.openCount !== undefined && input.openCount > 0
          ? new Date("2026-10-01T00:00:00.000Z")
          : null,
      openCount: input.openCount ?? 0,
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

  if (input.rsvp !== undefined) {
    await prisma.rSVP.create({
      data: {
        invitationId: invitation.id,
        status: input.rsvp,
        submittedAt: new Date("2026-10-01T01:00:00.000Z"),
      },
    });
  }

  return { invitation, publicCredential };
}

function validCreateBody(eventIds: string[]) {
  return {
    allowPlusOne: true,
    displayName: "Created Household",
    eventIds,
    greetingName: "Created Guests",
    invitees: [
      { category: "ADULT", fullName: "Alex Guest", label: "Primary" },
      { category: "CHILD", fullName: "Alex Guest", label: null },
    ],
    maxAdditionalChildren: 2,
    notes: "admin note",
    rsvpDeadlineAt: "2026-12-25T16:59:59.000Z",
  };
}

function ownerHeaders(session: OwnerSession) {
  return {
    cookie: session.cookie,
    origin: ADMIN_ORIGIN,
    "x-csrf-token": session.csrfToken,
  };
}

function credentialFromPublicUrl(publicUrl: string): string {
  return publicUrl.split("/i/")[1] ?? "";
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

describe("admin invitation mutations HTTP integration", () => {
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

  it("enforces shared unsafe admin security on every mutation route", async () => {
    const event = await createEvent({ displayOrder: 1 });
    const existing = await createInvitation(credentialService, {
      eventIds: [event.id],
    });
    const session = await createOwnerAndSession();
    const detail = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/invitations/${existing.invitation.id}`,
    });
    const updateBody = {
      displayName: "Security Updated",
      expectedUpdatedAt: detail.json().invitation.updatedAt,
    };
    const routes = [
      {
        method: "POST",
        payload: validCreateBody([event.id]),
        success: 201,
        url: "/api/admin/invitations",
      },
      {
        method: "PATCH",
        payload: updateBody,
        success: 200,
        url: `/api/admin/invitations/${existing.invitation.id}`,
      },
      {
        method: "POST",
        payload: {},
        success: 200,
        url: `/api/admin/invitations/${existing.invitation.id}/archive`,
      },
      {
        method: "POST",
        payload: { expectedTokenVersion: 1 },
        success: 200,
        url: `/api/admin/invitations/${existing.invitation.id}/regenerate-token`,
      },
    ] as const;

    for (const route of routes) {
      const missingSession = await app.getHttpAdapter().getInstance().inject({
        method: route.method,
        payload: route.payload,
        url: route.url,
      });
      expect(missingSession.statusCode, `${route.method} ${route.url}`).toBe(401);
      expect(missingSession.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }

    for (const route of routes) {
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
          origin: "http://localhost:3001.evil.test",
          "x-csrf-token": session.csrfToken,
        },
        method: route.method,
        payload: route.payload,
        url: route.url,
      });

      for (const response of [missingCsrf, wrongCsrf, badOrigin]) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({
          error: { code: "CSRF_INVALID" },
        });
      }
    }

    const validCreate = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: validCreateBody([event.id]),
      url: "/api/admin/invitations",
    });
    expect(validCreate.statusCode).toBe(201);
  });

  it("rejects a misconfigured public origin before committing an invitation", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    process.env.PUBLIC_INVITATION_BASE_URL =
      "https://invite.example.com/unexpected-path";
    try {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: ownerHeaders(session),
          method: "POST",
          payload: validCreateBody([event.id]),
          url: "/api/admin/invitations",
        });
      expect(response.statusCode).toBe(500);
      expect(await prisma.invitation.count()).toBe(0);
      expect(await prisma.invitee.count()).toBe(0);
      expect(await prisma.invitationEvent.count()).toBe(0);
      expect(await prisma.event.count()).toBe(1);
      expect(response.body).not.toContain("unexpected-path");
    } finally {
      process.env.PUBLIC_INVITATION_BASE_URL = PUBLIC_ORIGIN;
    }
  });

  it("creates an active invitation atomically with safe credential response", async () => {
    const session = await createOwnerAndSession();
    const ceremony = await createEvent({ displayOrder: 1, slug: "create-a" });
    const reception = await createEvent({ displayOrder: 2, slug: "create-b" });

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: validCreateBody([ceremony.id, reception.id]),
      url: "/api/admin/invitations",
    });
    const body = response.json();
    const invitation = await prisma.invitation.findUniqueOrThrow({
      include: {
        invitationEvents: { orderBy: { eventId: "asc" } },
        invitees: { orderBy: { displayOrder: "asc" } },
        rsvp: true,
      },
      where: { id: body.invitation.id },
    });
    const publicCredential = credentialFromPublicUrl(body.publicUrl);
    const publicLookup = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/public/invitations/${publicCredential}`,
    });

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject({
      invitation: {
        displayName: "Created Household",
        invitees: [
          {
            category: "ADULT",
            displayOrder: 0,
            fullName: "Alex Guest",
            label: "Primary",
          },
          {
            category: "CHILD",
            displayOrder: 1,
            fullName: "Alex Guest",
            label: null,
          },
        ],
        publicTokenVersion: 1,
        rsvp: null,
        status: "ACTIVE",
      },
      publicTokenVersion: 1,
      publicUrl: expect.stringMatching(new RegExp(`^${PUBLIC_ORIGIN}/i/`)),
    });
    expect(invitation.status).toBe(InvitationStatus.ACTIVE);
    expect(invitation.publicTokenVersion).toBe(1);
    expect(invitation.publicTokenHash).toBe(
      credentialService.hashCredential(publicCredential as DerivedCredential),
    );
    expect(invitation.publicTokenHash).not.toBe(publicCredential);
    expect(invitation.rsvp).toBeNull();
    expect(invitation.invitees.map((invitee) => invitee.displayOrder)).toEqual([
      0,
      1,
    ]);
    expect(invitation.invitationEvents.map((row) => row.eventId).sort()).toEqual(
      [ceremony.id, reception.id].sort(),
    );
    expect(publicLookup.statusCode).toBe(200);
    expect(publicLookup.json().invitation.displayName).toBe("Created Household");
    expect(responseKeys(body)).not.toContain("publicTokenHash");
    expect(responseKeys(body)).not.toContain("tokenHash");
    expect(responseKeys(body)).not.toContain("qrPayload");
  });

  it("rejects invalid create input without partial households", async () => {
    const session = await createOwnerAndSession();
    const active = await createEvent({ displayOrder: 1 });
    const inactive = await createEvent({ displayOrder: 2, isActive: false });
    const cases = [
      ["duplicate eventIds", { eventIds: [active.id, active.id] }],
      ["missing event", { eventIds: [randomUUID()] }],
      ["inactive event", { eventIds: [inactive.id] }],
      [
        "invalid invitee",
        { invitees: [{ category: "ADULT", fullName: "   " }] },
      ],
      ["invalid capacity", { maxAdditionalChildren: -1 }],
      ["invalid plus-one", { allowPlusOne: "yes" }],
    ] as const;

    for (const [label, override] of cases) {
      const before = await prisma.invitation.count();
      const response = await app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "POST",
        payload: { ...validCreateBody([active.id]), ...override },
        url: "/api/admin/invitations",
      });

      expect(response.statusCode, label).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
      expect(await prisma.invitation.count(), label).toBe(before);
      expect(await prisma.invitee.count(), label).toBe(0);
      expect(await prisma.invitationEvent.count(), label).toBe(0);
    }
  });

  it("edits invitations with expectedUpdatedAt and rejects stale or immutable writes", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const { invitation, publicCredential } = await createInvitation(
      credentialService,
      {
        eventIds: [event.id],
        openCount: 3,
      },
    );
    const detail = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/invitations/${invitation.id}`,
    });
    const original = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        allowPlusOne: true,
        displayName: "Edited Household",
        expectedUpdatedAt: detail.json().invitation.updatedAt,
        greetingName: "",
        maxAdditionalChildren: 1,
        notes: " edited notes ",
        rsvpDeadlineAt: null,
      },
      url: `/api/admin/invitations/${invitation.id}`,
    });
    const stale = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        displayName: "Stale Household",
        expectedUpdatedAt: detail.json().invitation.updatedAt,
      },
      url: `/api/admin/invitations/${invitation.id}`,
    });
    const immutable = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        expectedUpdatedAt: response.json().invitation.updatedAt,
        publicTokenVersion: 99,
      },
      url: `/api/admin/invitations/${invitation.id}`,
    });
    const after = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });
    const publicLookup = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/public/invitations/${publicCredential}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().invitation).toMatchObject({
      allowPlusOne: true,
      displayName: "Edited Household",
      greetingName: null,
      maxAdditionalChildren: 1,
      notes: "edited notes",
      publicTokenVersion: 1,
    });
    expect(Date.parse(response.json().invitation.updatedAt)).toBeGreaterThan(
      Date.parse(detail.json().invitation.updatedAt),
    );
    expect(stale.statusCode).toBe(409);
    expect(immutable.statusCode).toBe(400);
    expect(after.publicTokenHash).toBe(original.publicTokenHash);
    expect(after.publicTokenVersion).toBe(original.publicTokenVersion);
    expect(after.openCount).toBe(original.openCount);
    expect(after.firstOpenedAt).toEqual(original.firstOpenedAt);
    expect(after.lastOpenedAt).toEqual(original.lastOpenedAt);
    expect(publicLookup.statusCode).toBe(200);
    expect(publicLookup.json().invitation.displayName).toBe("Edited Household");
  });

  it("serializes concurrent edits with one success and one conflict", async () => {
    const session = await createOwnerAndSession();
    const { invitation } = await createInvitation(credentialService);
    const detail = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/invitations/${invitation.id}`,
    });
    const expectedUpdatedAt = detail.json().invitation.updatedAt;

    const [left, right] = await Promise.all([
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: { displayName: "Left Edit", expectedUpdatedAt },
        url: `/api/admin/invitations/${invitation.id}`,
      }),
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: { displayName: "Right Edit", expectedUpdatedAt },
        url: `/api/admin/invitations/${invitation.id}`,
      }),
    ]);
    const statuses = [left.statusCode, right.statusCode].sort();
    const after = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });

    expect(statuses).toEqual([200, 409]);
    expect(["Left Edit", "Right Edit"]).toContain(after.displayName);
  });

  it("returns not found for missing invitations and conflict for archived edits or rotations", async () => {
    const session = await createOwnerAndSession();
    const archived = await createInvitation(credentialService, {
      status: InvitationStatus.ARCHIVED,
    });
    const missingId = randomUUID();
    const timestamp = new Date("2026-10-01T00:00:00.000Z").toISOString();

    const patchMissing = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: { displayName: "Missing", expectedUpdatedAt: timestamp },
      url: `/api/admin/invitations/${missingId}`,
    });
    const patchArchived = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "PATCH",
      payload: {
        displayName: "Archived",
        expectedUpdatedAt: archived.invitation.updatedAt.toISOString(),
      },
      url: `/api/admin/invitations/${archived.invitation.id}`,
    });
    const archiveMissing = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: {},
      url: `/api/admin/invitations/${missingId}/archive`,
    });
    const regenerateMissing = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { expectedTokenVersion: 1 },
      url: `/api/admin/invitations/${missingId}/regenerate-token`,
    });
    const regenerateArchived = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { expectedTokenVersion: 1 },
      url: `/api/admin/invitations/${archived.invitation.id}/regenerate-token`,
    });

    expect(patchMissing.statusCode).toBe(404);
    expect(patchArchived.statusCode).toBe(409);
    expect(archiveMissing.statusCode).toBe(404);
    expect(regenerateMissing.statusCode).toBe(404);
    expect(regenerateArchived.statusCode).toBe(409);
  });

  it("archives idempotently and disables public surfaces while preserving history", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const created = await createInvitation(credentialService, {
      eventIds: [event.id],
      rsvp: RSVPStatus.ACCEPTED,
    });
    const rsvp = await prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: created.invitation.id },
    });
    await prisma.guestMessage.create({
      data: { invitationId: created.invitation.id, message: "history" },
    });
    await prisma.checkinPass.create({
      data: {
        invitationId: created.invitation.id,
        rsvpId: rsvp.id,
        status: CheckinPassStatus.ACTIVE,
        tokenHash: `pass-${randomUUID()}`,
      },
    });

    const first = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: {},
      url: `/api/admin/invitations/${created.invitation.id}/archive`,
    });
    const second = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: {},
      url: `/api/admin/invitations/${created.invitation.id}/archive`,
    });
    const adminDetail = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/invitations/${created.invitation.id}`,
    });
    const adminPublicUrl = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/invitations/${created.invitation.id}/public-url`,
    });
    const publicInvitation = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/public/invitations/${created.publicCredential}`,
    });
    const publicRsvp = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/public/invitations/${created.publicCredential}/rsvp`,
    });
    const publicMessage = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      payload: { message: "hello" },
      url: `/api/public/invitations/${created.publicCredential}/messages`,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().invitation.archivedAt).toBe(
      second.json().invitation.archivedAt,
    );
    expect(adminDetail.statusCode).toBe(200);
    expect(adminDetail.json().invitation.status).toBe("ARCHIVED");
    expect(adminDetail.json().invitation.messages).toEqual({
      hidden: 0,
      total: 1,
    });
    expect(adminDetail.json().invitation.checkinPasses).toHaveLength(1);
    expect(adminPublicUrl.statusCode).toBe(409);
    expect(publicInvitation.statusCode).toBe(404);
    expect(publicRsvp.statusCode).toBe(404);
    expect(publicMessage.statusCode).toBe(404);
  });

  it("serializes concurrent archive requests idempotently", async () => {
    const session = await createOwnerAndSession();
    const { invitation } = await createInvitation(credentialService);

    const [left, right] = await Promise.all([
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "POST",
        payload: {},
        url: `/api/admin/invitations/${invitation.id}/archive`,
      }),
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "POST",
        payload: {},
        url: `/api/admin/invitations/${invitation.id}/archive`,
      }),
    ]);

    expect([left.statusCode, right.statusCode]).toEqual([200, 200]);
    expect(left.json().invitation.archivedAt).toBe(
      right.json().invitation.archivedAt,
    );
  });

  it("regenerates the public token once per expected version and supports recovery", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({ displayOrder: 1 });
    const created = await createInvitation(credentialService, {
      eventIds: [event.id],
      openCount: 5,
    });
    const before = await prisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { expectedTokenVersion: 1 },
      url: `/api/admin/invitations/${created.invitation.id}/regenerate-token`,
    });
    const stale = await app.getHttpAdapter().getInstance().inject({
      headers: ownerHeaders(session),
      method: "POST",
      payload: { expectedTokenVersion: 1 },
      url: `/api/admin/invitations/${created.invitation.id}/regenerate-token`,
    });
    const recovery = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: session.cookie },
      method: "GET",
      url: `/api/admin/invitations/${created.invitation.id}/public-url`,
    });
    const after = await prisma.invitation.findUniqueOrThrow({
      where: { id: created.invitation.id },
    });
    const oldLookup = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/public/invitations/${created.publicCredential}`,
    });
    const newCredential = credentialFromPublicUrl(response.json().publicUrl);
    const newLookup = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/api/public/invitations/${newCredential}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      publicTokenVersion: 2,
      publicUrl: expect.stringMatching(new RegExp(`^${PUBLIC_ORIGIN}/i/`)),
    });
    expect(stale.statusCode).toBe(409);
    expect(recovery.statusCode).toBe(200);
    expect(recovery.json()).toEqual(response.json());
    expect(after.publicTokenVersion).toBe(2);
    expect(after.publicTokenHash).not.toBe(before.publicTokenHash);
    expect(after.openCount).toBe(5);
    expect(after.firstOpenedAt).toEqual(before.firstOpenedAt);
    expect(after.lastOpenedAt).toEqual(before.lastOpenedAt);
    expect(oldLookup.statusCode).toBe(404);
    expect(newLookup.statusCode).toBe(200);
    expect(responseKeys(response.json())).not.toContain("publicTokenHash");
    expect(responseKeys(response.json())).not.toContain("tokenHash");
    expect(responseKeys(response.json())).not.toContain("qrPayload");
  });

  it("serializes concurrent token regeneration with exactly one rotation", async () => {
    const session = await createOwnerAndSession();
    const { invitation } = await createInvitation(credentialService);

    const [left, right] = await Promise.all([
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "POST",
        payload: { expectedTokenVersion: 1 },
        url: `/api/admin/invitations/${invitation.id}/regenerate-token`,
      }),
      app.getHttpAdapter().getInstance().inject({
        headers: ownerHeaders(session),
        method: "POST",
        payload: { expectedTokenVersion: 1 },
        url: `/api/admin/invitations/${invitation.id}/regenerate-token`,
      }),
    ]);
    const after = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
    });

    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    expect(after.publicTokenVersion).toBe(2);
  });
});
