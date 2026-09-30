import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureApp } from "../app.setup.js";
import { getDatabaseUrl } from "../database/database-url.js";
import {
  InvitationStatus,
  PrismaClient,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { AppLogger } from "../logging/app-logger.js";
import {
  deriveCredentialWithSecret,
  hashDerivedCredential,
} from "../security/credential.service.js";
import type { DerivedCredential } from "../security/credential.types.js";
import { MessagesModule } from "./messages.module.js";

const TEST_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const TEST_SECRET_BYTES = Buffer.from(TEST_SECRET, "base64url");
const VALID_UNKNOWN_CREDENTIAL = deriveCredentialWithSecret(
  {
    namespace: "invitation",
    stableId: "00000000-0000-0000-0000-000000000001",
    version: 1,
  },
  TEST_SECRET_BYTES,
);

process.env.CREDENTIAL_SECRET ??= TEST_SECRET;

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const createdInvitationIds: string[] = [];
const logEntries: Array<Record<string, unknown>> = [];

const testLogger = {
  debug: () => {},
  error: () => {},
  fatal: () => {},
  info: (fields: Record<string, unknown>) => {
    logEntries.push(fields);
  },
  log: () => {},
  verbose: () => {},
  warn: () => {},
};

@Module({
  imports: [MessagesModule],
  providers: [
    {
      provide: AppLogger,
      useValue: testLogger,
    },
  ],
})
class PublicGuestMessageHttpTestModule {}

type Fixture = {
  credential: DerivedCredential;
  invitationId: string;
};

function createCredential(stableId: string): DerivedCredential {
  return deriveCredentialWithSecret(
    {
      namespace: "invitation",
      stableId,
      version: 1,
    },
    TEST_SECRET_BYTES,
  );
}

async function createFixture(
  options: {
    rsvpDeadlineAt?: Date | null;
    rsvpStatus?: RSVPStatus;
    status?: InvitationStatus;
  } = {},
): Promise<Fixture> {
  const invitationId = randomUUID();
  const credential = createCredential(invitationId);
  const invitation = await prisma.invitation.create({
    data: {
      displayName: `HTTP Message Household ${randomUUID()}`,
      id: invitationId,
      publicTokenHash: hashDerivedCredential(credential),
      rsvpDeadlineAt:
        options.rsvpDeadlineAt ?? new Date("2026-12-25T16:59:59.000Z"),
      status: options.status ?? InvitationStatus.ACTIVE,
    },
  });
  createdInvitationIds.push(invitation.id);

  if (options.rsvpStatus !== undefined) {
    await prisma.rSVP.create({
      data: {
        invitationId: invitation.id,
        status: options.rsvpStatus,
        version: 1,
      },
    });
  }

  return {
    credential,
    invitationId: invitation.id,
  };
}

async function getMessages(invitationId: string) {
  return prisma.guestMessage.findMany({
    where: { invitationId },
    orderBy: { createdAt: "asc" },
  });
}

async function cleanupFixtures() {
  if (createdInvitationIds.length === 0) {
    return;
  }

  await prisma.guestMessage.deleteMany({
    where: { invitationId: { in: createdInvitationIds } },
  });
  await prisma.rSVP.deleteMany({
    where: { invitationId: { in: createdInvitationIds } },
  });
  await prisma.invitation.deleteMany({
    where: { id: { in: createdInvitationIds } },
  });

  createdInvitationIds.length = 0;
}

describe("POST /api/public/invitations/:publicCredential/messages", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      PublicGuestMessageHttpTestModule,
      new FastifyAdapter(),
      { bufferLogs: true },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app.close();
    await prisma.$disconnect();
  });

  it("creates a message with 201, a minimal response, request ID propagation, and no echoed content", async () => {
    const fixture = await createFixture();
    logEntries.length = 0;

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: {
        "x-request-id": "req-message-success",
      },
      method: "POST",
      payload: {
        authorName: "  Jo  ",
        message: "  Congratulations!\nHave a wonderful life.  ",
      },
      url: `/api/public/invitations/${fixture.credential}/messages`,
    });
    const messages = await getMessages(fixture.invitationId);
    const logEntry = logEntries.at(-1);

    expect(response.statusCode).toBe(201);
    expect(response.headers["x-request-id"]).toBe("req-message-success");
    expect(response.json()).toEqual({
      message: {
        createdAt: expect.any(String),
      },
    });
    expect(Object.keys(response.json().message)).toEqual(["createdAt"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      authorName: "Jo",
      invitationId: fixture.invitationId,
      isHidden: false,
      message: "Congratulations!\nHave a wonderful life.",
    });
    expect(response.body).not.toContain(messages[0]!.id);
    expect(response.body).not.toContain(fixture.invitationId);
    expect(response.body).not.toContain("isHidden");
    expect(response.body).not.toContain("Congratulations");
    expect(response.body).not.toContain("Jo");
    expect(JSON.stringify(logEntry)).not.toContain("Congratulations");
    expect(JSON.stringify(logEntry)).not.toContain("Jo");
    expect(JSON.stringify(logEntry)).not.toContain(fixture.credential);
  });

  it("maps validation failures to VALIDATION_ERROR without writing rows", async () => {
    const fixture = await createFixture();
    const invalidPayloads: Array<Record<string, unknown>> = [
      {},
      { message: "" },
      { message: "   " },
      { message: "\n\n" },
      { message: "🙂".repeat(1001) },
      { authorName: "🎉".repeat(101), message: "Hello" },
      { authorName: 1, message: "Hello" },
      { message: 1 },
      { invitationId: randomUUID(), isHidden: true, message: "Hello" },
    ];

    for (const [index, payload] of invalidPayloads.entries()) {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        payload,
        url: `/api/public/invitations/${fixture.credential}/messages`,
      });

      expect(response.statusCode, `case ${index}`).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: null,
          message: "Validation error",
        },
      });
      expect(response.body).not.toContain(fixture.credential);
    }

    await expect(getMessages(fixture.invitationId)).resolves.toHaveLength(0);
  });

  it("treats unknown and archived invitations as the same unavailable response", async () => {
    const archived = await createFixture({ status: InvitationStatus.ARCHIVED });

    for (const credential of [VALID_UNKNOWN_CREDENTIAL, archived.credential]) {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        payload: {
          message: "Best wishes",
        },
        url: `/api/public/invitations/${credential}/messages`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: {
          code: "INVITATION_NOT_AVAILABLE",
          details: null,
          message: "Resource not found",
        },
      });
      expect(response.body).not.toContain(credential);
      expect(response.body).not.toContain("ARCHIVED");
    }

    await expect(getMessages(archived.invitationId)).resolves.toHaveLength(0);
  });

  it("allows active invitations regardless of RSVP state or past RSVP deadline", async () => {
    const accepted = await createFixture({ rsvpStatus: RSVPStatus.ACCEPTED });
    const declined = await createFixture({ rsvpStatus: RSVPStatus.DECLINED });
    const pastDeadline = await createFixture({
      rsvpDeadlineAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    for (const fixture of [accepted, declined, pastDeadline]) {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "POST",
        payload: {
          authorName: "  ",
          message: "Best wishes",
        },
        url: `/api/public/invitations/${fixture.credential}/messages`,
      });

      expect(response.statusCode).toBe(201);
      await expect(getMessages(fixture.invitationId)).resolves.toMatchObject([
        {
          authorName: null,
          message: "Best wishes",
        },
      ]);
    }
  });

  it("creates a new row for each explicit duplicate submission", async () => {
    const fixture = await createFixture();

    await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      payload: { authorName: "Jo", message: "Again" },
      url: `/api/public/invitations/${fixture.credential}/messages`,
    });
    await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      payload: { authorName: "Jo", message: "Again" },
      url: `/api/public/invitations/${fixture.credential}/messages`,
    });

    await expect(getMessages(fixture.invitationId)).resolves.toHaveLength(2);
  });
});
