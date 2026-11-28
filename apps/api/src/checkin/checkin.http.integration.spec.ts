import "reflect-metadata";
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
  PrismaClient,
} from "../generated/prisma/client.js";
const ADMIN_ORIGIN = "http://localhost:3001";
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
  status?: AdminUserStatus;
}) {
  const user = await prisma.adminUser.create({
    data: {
      email: input.email,
      mustChangePassword: input.mustChangePassword ?? false,
      passwordHash: await passwordService.hashPassword(PASSWORD),
      role: input.role,
      status: input.status ?? AdminUserStatus.ACTIVE,
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

describe("admin check-in HTTP integration", () => {
  let app: NestFastifyApplication;

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

  it("retires every digital attendance write and scan even for authenticated operators", async () => {
    const owner = await createUserAndSession({
      email: OWNER_EMAIL,
      role: AdminRole.OWNER,
    });
    const staff = await createUserAndSession({
      email: STAFF_EMAIL,
      role: AdminRole.CHECKIN_STAFF,
    });
    const manager = await createUserAndSession({
      email: "manager@example.test",
      role: AdminRole.GUEST_MANAGER,
    });
    for (const [session, prefix, paths] of [
      [
        owner,
        "checkin",
        ["validate", "confirm", "manual-confirm", "manual-status"],
      ],
      [staff, "checkin", ["validate", "confirm", "manual-confirm"]],
      [
        owner,
        "reception",
        ["validate", "arrivals", "walkins", "corrections", "exceptions"],
      ],
      [
        manager,
        "reception",
        ["validate", "arrivals", "walkins", "corrections", "exceptions"],
      ],
    ] as const) {
      for (const path of paths) {
        const result = await app.inject({
          method: "POST",
          url: `/api/admin/${prefix}/${path}`,
          headers: unsafeHeaders(session),
          payload: {},
        });
        expect(result.statusCode, prefix + "/" + path).toBe(410);
        expect(result.json()).toMatchObject({
          error: { code: "DIGITAL_ATTENDANCE_RETIRED" },
        });
      }
    }
    expect(await prisma.checkinRecord.count()).toBe(0);
    expect(await prisma.checkinPass.count()).toBe(0);
    expect(await prisma.walkinRegistration.count()).toBe(0);
    expect(await prisma.receptionAction.count()).toBe(0);
  });

  it("retains session and CSRF checks for retired routes", async () => {
    const url = "/api/admin/reception/walkins";
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { origin: ADMIN_ORIGIN },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    const owner = await createUserAndSession({
      email: OWNER_EMAIL,
      role: AdminRole.OWNER,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { cookie: owner.cookie, origin: ADMIN_ORIGIN },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
  });
});
