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
import { InvitationStatus, PrismaClient } from "../generated/prisma/client.js";
import { CredentialService } from "../security/credential.service.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const PUBLIC_ORIGIN = "http://localhost:3000";
const OWNER_EMAIL = "owner-8d5@example.com";
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

async function createInvitation(
  credentialService: CredentialService,
  input: {
    displayName: string;
    openCount?: number;
    status?: InvitationStatus;
  },
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
      displayName: input.displayName,
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

  return { invitation, publicCredential };
}

async function createMessage(input: {
  authorName?: string | null;
  createdAt?: Date;
  id?: string;
  invitationId: string;
  isHidden?: boolean;
  message?: string;
}) {
  return prisma.guestMessage.create({
    data: {
      authorName: input.authorName ?? null,
      createdAt: input.createdAt ?? new Date("2026-10-01T02:00:00.000Z"),
      id: input.id ?? randomUUID(),
      invitationId: input.invitationId,
      isHidden: input.isHidden ?? false,
      message: input.message ?? "Best wishes",
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

describe("admin guest message HTTP integration", () => {
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

  it("enforces admin session security and CSRF only for message moderation", async () => {
    const session = await createOwnerAndSession();
    const { invitation } = await createInvitation(credentialService, {
      displayName: "Security Household",
    });
    const message = await createMessage({ invitationId: invitation.id });

    for (const url of [
      "/api/admin/messages",
      `/api/admin/invitations/${invitation.id}/messages`,
    ]) {
      const noSession = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url,
      });
      const owner = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { cookie: session.cookie },
          method: "GET",
          url,
        });

      expect(noSession.statusCode, url).toBe(401);
      expect(noSession.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
      expect(owner.statusCode, url).toBe(200);
    }

    const patchUrl = `/api/admin/messages/${message.id}`;
    const noSessionPatch = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PATCH",
        payload: { isHidden: true },
        url: patchUrl,
      });
    const missingCsrf = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie, origin: ADMIN_ORIGIN },
        method: "PATCH",
        payload: { isHidden: true },
        url: patchUrl,
      });
    const wrongCsrf = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          cookie: session.cookie,
          origin: ADMIN_ORIGIN,
          "x-csrf-token": "wrong",
        },
        method: "PATCH",
        payload: { isHidden: true },
        url: patchUrl,
      });
    const badOrigin = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          cookie: session.cookie,
          origin: "http://localhost:3001.evil.test",
          "x-csrf-token": session.csrfToken,
        },
        method: "PATCH",
        payload: { isHidden: true },
        url: patchUrl,
      });
    const ownerPatch = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: { isHidden: true },
        url: patchUrl,
      });

    expect(noSessionPatch.statusCode).toBe(401);
    for (const response of [missingCsrf, wrongCsrf, badOrigin]) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "CSRF_INVALID" },
      });
    }
    expect(ownerPatch.statusCode).toBe(200);
    expect(ownerPatch.json()).toMatchObject({ isHidden: true });
  });

  it("lists global guest messages with hidden filters, ordering, pagination, archived history, and privacy", async () => {
    const session = await createOwnerAndSession();
    const empty = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/messages",
      });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      items: [],
      page: {
        number: 1,
        pageSize: 25,
        totalItems: 0,
        totalPages: 0,
      },
    });

    const activeA = await createInvitation(credentialService, {
      displayName: "Alpha Household",
      openCount: 2,
    });
    const activeB = await createInvitation(credentialService, {
      displayName: "Beta Household",
    });
    const archived = await createInvitation(credentialService, {
      displayName: "Archived Household",
      status: InvitationStatus.ARCHIVED,
    });
    const sameTimestamp = new Date("2026-10-01T02:00:00.000Z");
    const visibleA = await createMessage({
      authorName: "Visible A",
      createdAt: sameTimestamp,
      id: "00000000-0000-4000-8000-000000000001",
      invitationId: activeA.invitation.id,
      isHidden: false,
      message: "Alpha visible",
    });
    const hiddenA = await createMessage({
      authorName: "Hidden A",
      createdAt: sameTimestamp,
      id: "00000000-0000-4000-8000-000000000002",
      invitationId: activeA.invitation.id,
      isHidden: true,
      message: "Alpha hidden",
    });
    const visibleB = await createMessage({
      authorName: null,
      createdAt: new Date("2026-10-01T03:00:00.000Z"),
      id: "00000000-0000-4000-8000-000000000003",
      invitationId: activeB.invitation.id,
      isHidden: false,
      message: "Beta visible",
    });
    const hiddenArchived = await createMessage({
      authorName: "Archived guest",
      createdAt: new Date("2026-10-01T01:00:00.000Z"),
      id: "00000000-0000-4000-8000-000000000004",
      invitationId: archived.invitation.id,
      isHidden: true,
      message: "Archived hidden",
    });

    const all = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/messages?pageSize=10",
      });
    const visible = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/messages?hidden=visible&sortOrder=asc&pageSize=10",
      });
    const hidden = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/messages?hidden=hidden&pageSize=10",
      });
    const activeAOnly = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/messages?invitationId=${activeA.invitation.id}&pageSize=10`,
      });
    const beyondEnd = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/messages?page=3&pageSize=2",
      });

    expect(all.statusCode).toBe(200);
    expect(all.json().items.map((item: { id: string }) => item.id)).toEqual([
      visibleB.id,
      visibleA.id,
      hiddenA.id,
      hiddenArchived.id,
    ]);
    expect(all.json().items[0]).toEqual({
      authorName: null,
      createdAt: visibleB.createdAt.toISOString(),
      id: visibleB.id,
      invitation: {
        displayName: activeB.invitation.displayName,
        id: activeB.invitation.id,
      },
      isHidden: false,
      message: "Beta visible",
    });
    expect(visible.json().items.map((item: { id: string }) => item.id)).toEqual(
      [visibleA.id, visibleB.id],
    );
    expect(hidden.json().items.map((item: { id: string }) => item.id)).toEqual([
      hiddenA.id,
      hiddenArchived.id,
    ]);
    expect(
      activeAOnly.json().items.map((item: { id: string }) => item.id),
    ).toEqual([visibleA.id, hiddenA.id]);
    expect(beyondEnd.statusCode).toBe(200);
    expect(beyondEnd.json()).toEqual({
      items: [],
      page: {
        number: 3,
        pageSize: 2,
        totalItems: 4,
        totalPages: 2,
      },
    });

    const keys = responseKeys(all.json());
    for (const forbiddenKey of [
      "publicTokenHash",
      "publicUrl",
      "qrPayload",
      "tokenHash",
      "passwordHash",
      "sessionToken",
      "sessionTokenHash",
      "csrfTokenHash",
      "dietaryNotes",
      "guestNote",
    ]) {
      expect(keys).not.toContain(forbiddenKey);
    }

    for (const url of [
      "/api/admin/messages?hidden=maybe",
      "/api/admin/messages?pageSize=101",
      "/api/admin/messages?sortBy=message",
      "/api/admin/messages?search=Alpha",
      "/api/admin/messages?q=Alpha",
    ]) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { cookie: session.cookie },
          method: "GET",
          url,
        });

      expect(response.statusCode, url).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });

  it("lists invitation-scoped guest messages without open-count side effects", async () => {
    const session = await createOwnerAndSession();
    const activeA = await createInvitation(credentialService, {
      displayName: "Scoped Alpha",
      openCount: 5,
    });
    const activeB = await createInvitation(credentialService, {
      displayName: "Scoped Beta",
    });
    const emptyInvitation = await createInvitation(credentialService, {
      displayName: "Empty Messages",
    });
    const first = await createMessage({
      authorName: "First",
      createdAt: new Date("2026-10-01T02:00:00.000Z"),
      invitationId: activeA.invitation.id,
      isHidden: false,
      message: "First scoped",
    });
    const second = await createMessage({
      authorName: "Second",
      createdAt: new Date("2026-10-01T03:00:00.000Z"),
      invitationId: activeA.invitation.id,
      isHidden: true,
      message: "Second scoped",
    });
    await createMessage({
      invitationId: activeB.invitation.id,
      message: "Other invitation",
    });

    const empty = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${emptyInvitation.invitation.id}/messages`,
      });
    const scoped = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${activeA.invitation.id}/messages?pageSize=10`,
      });
    const scopedHidden = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${activeA.invitation.id}/messages?hidden=hidden`,
      });
    const mismatch = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${activeA.invitation.id}/messages?invitationId=${activeB.invitation.id}`,
      });
    const malformed = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/invitations/not-a-uuid/messages",
      });
    const missing = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${randomUUID()}/messages`,
      });
    const after = await prisma.invitation.findUniqueOrThrow({
      select: { openCount: true },
      where: { id: activeA.invitation.id },
    });

    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      items: [],
      page: {
        number: 1,
        pageSize: 25,
        totalItems: 0,
        totalPages: 0,
      },
    });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().items.map((item: { id: string }) => item.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(scopedHidden.statusCode).toBe(200);
    expect(scopedHidden.json().items).toHaveLength(1);
    expect(scopedHidden.json().items[0]).toMatchObject({
      id: second.id,
      invitation: {
        displayName: activeA.invitation.displayName,
        id: activeA.invitation.id,
      },
      isHidden: true,
    });
    expect(mismatch.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(after.openCount).toBe(5);
  });

  it("moderates visibility idempotently while preserving content and public submission behavior", async () => {
    const session = await createOwnerAndSession();
    const { invitation, publicCredential } = await createInvitation(
      credentialService,
      {
        displayName: "Moderation Household",
      },
    );
    const message = await createMessage({
      authorName: "Guest Author",
      invitationId: invitation.id,
      message: "Original message",
    });

    const beforeDetail = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${invitation.id}`,
      });
    expect(beforeDetail.statusCode).toBe(200);
    expect(beforeDetail.json().invitation.messages).toEqual({
      hidden: 0,
      total: 1,
    });

    const hide = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: { isHidden: true },
        url: `/api/admin/messages/${message.id}`,
      });
    const hideAgain = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: { isHidden: true },
        url: `/api/admin/messages/${message.id}`,
      });
    const show = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: { isHidden: false },
        url: `/api/admin/messages/${message.id}`,
      });
    const showAgain = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: ownerHeaders(session),
        method: "PATCH",
        payload: { isHidden: false },
        url: `/api/admin/messages/${message.id}`,
      });
    const afterMessage = await prisma.guestMessage.findUniqueOrThrow({
      where: { id: message.id },
    });
    const afterDetail = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${invitation.id}`,
      });

    for (const response of [hide, hideAgain, show, showAgain]) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        authorName: "Guest Author",
        id: message.id,
        invitation: {
          displayName: invitation.displayName,
          id: invitation.id,
        },
        message: "Original message",
      });
      expect(responseKeys(response.json())).not.toEqual(
        expect.arrayContaining([
          "hiddenAt",
          "hiddenByAdminUserId",
          "moderatedAt",
          "moderationReason",
        ]),
      );
    }
    expect(hide.json().isHidden).toBe(true);
    expect(hideAgain.json().isHidden).toBe(true);
    expect(show.json().isHidden).toBe(false);
    expect(showAgain.json().isHidden).toBe(false);
    expect(afterMessage).toMatchObject({
      authorName: "Guest Author",
      invitationId: invitation.id,
      isHidden: false,
      message: "Original message",
    });
    expect(afterMessage.createdAt.toISOString()).toBe(
      message.createdAt.toISOString(),
    );
    expect(afterDetail.statusCode).toBe(200);
    expect(afterDetail.json().invitation.messages).toEqual({
      hidden: 0,
      total: 1,
    });

    for (const [url, payload, expectedStatus] of [
      [`/api/admin/messages/${randomUUID()}`, { isHidden: true }, 404],
      ["/api/admin/messages/not-a-uuid", { isHidden: true }, 400],
      [`/api/admin/messages/${message.id}`, {}, 400],
      [`/api/admin/messages/${message.id}`, { isHidden: "true" }, 400],
      [
        `/api/admin/messages/${message.id}`,
        { isHidden: true, message: "edit" },
        400,
      ],
    ] as const) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: ownerHeaders(session),
          method: "PATCH",
          payload,
          url,
        });

      expect(response.statusCode, url).toBe(expectedStatus);
    }

    const publicPost = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: {
          authorName: "Fresh Guest",
          message: "Public message still works",
        },
        url: `/api/public/invitations/${publicCredential}/messages`,
      });
    const messages = await prisma.guestMessage.findMany({
      orderBy: { createdAt: "asc" },
      where: { invitationId: invitation.id },
    });

    expect(publicPost.statusCode).toBe(201);
    expect(publicPost.json()).toEqual({
      message: {
        createdAt: expect.any(String),
      },
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      authorName: "Fresh Guest",
      isHidden: false,
      message: "Public message still works",
    });

    const archived = await createInvitation(credentialService, {
      displayName: "Archived Public Message Household",
      status: InvitationStatus.ARCHIVED,
    });
    const archivedPost = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        payload: { message: "Archived should stay unavailable" },
        url: `/api/public/invitations/${archived.publicCredential}/messages`,
      });

    expect(archivedPost.statusCode).toBe(404);
    await expect(
      prisma.guestMessage.count({
        where: { invitationId: archived.invitation.id },
      }),
    ).resolves.toBe(0);
  });
});
