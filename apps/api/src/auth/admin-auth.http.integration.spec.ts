import "reflect-metadata";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureApp } from "../app.setup.js";
import { getDatabaseUrl } from "../database/database-url.js";
import {
  AdminRole,
  AdminUserStatus,
  PrismaClient,
} from "../generated/prisma/client.js";
import { AppLogger } from "../logging/app-logger.js";
import { AdminAuthController } from "./admin-auth.controller.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { AdminOriginService } from "./admin-origin.service.js";
import { AdminSessionService } from "./admin-session.service.js";
import { AdminCookieService } from "./cookie.service.js";
import {
  ADMIN_AUTH_CLOCK,
  LoginThrottleService,
} from "./login-throttle.service.js";
import { AdminPasswordService } from "./password.service.js";
import { AdminSessionTokenService } from "./session-token.service.js";
import { DatabaseModule } from "../database/database.module.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const OWNER_EMAIL = "owner@example.com";
const OWNER_PASSWORD = "correct horse battery staple";

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const passwordService = new AdminPasswordService();
const tokenService = new AdminSessionTokenService();
const logEntries: Array<Record<string, unknown>> = [];

let currentTime = new Date("2026-09-30T00:00:00.000Z");

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
  imports: [DatabaseModule],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminCookieService,
    AdminOriginService,
    AdminPasswordService,
    AdminSessionService,
    AdminSessionTokenService,
    LoginThrottleService,
    {
      provide: ADMIN_AUTH_CLOCK,
      useValue: () => currentTime,
    },
    {
      provide: AppLogger,
      useValue: testLogger,
    },
  ],
})
class AdminAuthHttpTestModule {}

async function cleanAdminAuth() {
  await prisma.checkinRecord.deleteMany();
  await prisma.guestImportPreview.deleteMany();
  await prisma.guestImportBatch.deleteMany();
  await prisma.rSVP.updateMany({
    data: { submittedByAdminUserId: null },
    where: { submittedByAdminUserId: { not: null } },
  });
  await prisma.adminSession.deleteMany();
  await prisma.adminUser.deleteMany();
}

async function createOwner(options: {
  email?: string;
  mustChangePassword?: boolean;
  password?: string;
  status?: AdminUserStatus;
} = {}) {
  return prisma.adminUser.create({
    data: {
      email: options.email ?? OWNER_EMAIL,
      mustChangePassword: options.mustChangePassword ?? false,
      passwordHash: await passwordService.hashPassword(
        options.password ?? OWNER_PASSWORD,
      ),
      role: AdminRole.OWNER,
      status: options.status ?? AdminUserStatus.ACTIVE,
    },
  });
}

async function createStaff(options: {
  email?: string;
  mustChangePassword?: boolean;
  password?: string;
  status?: AdminUserStatus;
} = {}) {
  return prisma.adminUser.create({
    data: {
      email: options.email ?? "staff@example.com",
      mustChangePassword: options.mustChangePassword ?? false,
      passwordHash: await passwordService.hashPassword(
        options.password ?? OWNER_PASSWORD,
      ),
      role: AdminRole.CHECKIN_STAFF,
      status: options.status ?? AdminUserStatus.ACTIVE,
    },
  });
}

function getSetCookie(response: { headers: Record<string, unknown> }): string {
  const value = response.headers["set-cookie"];

  if (Array.isArray(value)) {
    return String(value[0]);
  }

  return String(value);
}

function getCookieHeader(setCookie: string): string {
  return setCookie.split(";")[0]!;
}

function getCookieValue(setCookie: string): string {
  return getCookieHeader(setCookie).split("=")[1]!;
}

async function login(app: NestFastifyApplication, payload = {
  email: OWNER_EMAIL,
  password: OWNER_PASSWORD,
}) {
  return app.getHttpAdapter().getInstance().inject({
    headers: { origin: ADMIN_ORIGIN },
    method: "POST",
    payload,
    url: "/api/admin/auth/login",
  });
}

async function createSession(userId: string, options: {
  createdAt?: Date;
  expiresAt?: Date;
  lastSeenAt?: Date | null;
  revokedAt?: Date | null;
} = {}) {
  const tokens = tokenService.generateSessionTokens();
  await prisma.adminSession.create({
    data: {
      adminUserId: userId,
      createdAt: options.createdAt ?? currentTime,
      csrfTokenHash: tokens.csrfTokenHash,
      expiresAt:
        options.expiresAt ??
        new Date(currentTime.getTime() + 12 * 60 * 60 * 1000),
      lastSeenAt: options.lastSeenAt,
      revokedAt: options.revokedAt,
      sessionTokenHash: tokens.sessionTokenHash,
    },
  });

  return tokens;
}

describe("admin auth HTTP integration", () => {
  let app: NestFastifyApplication;
  let throttleService: LoginThrottleService;

  beforeAll(async () => {
    process.env.ADMIN_ORIGIN = ADMIN_ORIGIN;
    process.env.NODE_ENV = "test";
    app = await NestFactory.create<NestFastifyApplication>(
      AdminAuthHttpTestModule,
      new FastifyAdapter(),
      { bufferLogs: true },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    throttleService = app.get(LoginThrottleService);
  });

  beforeEach(async () => {
    currentTime = new Date("2026-09-30T00:00:00.000Z");
    throttleService.reset();
    logEntries.length = 0;
    await cleanAdminAuth();
  });

  afterAll(async () => {
    await cleanAdminAuth();
    await app.close();
    await prisma.$disconnect();
  });

  it("logs in an active OWNER, creates hashed session storage, sets the dev cookie, and updates lastLoginAt", async () => {
    const owner = await createOwner();

    const response = await login(app, {
      email: "  OWNER@Example.COM  ",
      password: OWNER_PASSWORD,
    });
    const body = response.json();
    const setCookie = getSetCookie(response);
    const sessionToken = getCookieValue(setCookie);
    const session = await prisma.adminSession.findFirstOrThrow({
      where: { adminUserId: owner.id },
    });
    const updatedOwner = await prisma.adminUser.findUniqueOrThrow({
      where: { id: owner.id },
    });

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      csrfToken: expect.any(String),
      session: {
        expiresAt: new Date(
          currentTime.getTime() + 12 * 60 * 60 * 1000,
        ).toISOString(),
      },
      user: {
        email: OWNER_EMAIL,
        id: owner.id,
        mustChangePassword: false,
        role: AdminRole.OWNER,
      },
    });
    expect(setCookie).toContain("admin_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).not.toContain("Secure");
    expect(setCookie).not.toContain("Domain=");
    expect(sessionToken).toHaveLength(43);
    expect(Buffer.from(sessionToken, "base64url")).toHaveLength(32);
    expect(session.sessionTokenHash).toBe(
      createHash("sha256")
        .update(Buffer.from(sessionToken, "base64url"))
        .digest("hex"),
    );
    expect(session.csrfTokenHash).toBe(
      createHash("sha256").update(body.csrfToken, "utf8").digest("hex"),
    );
    expect(JSON.stringify(session)).not.toContain(sessionToken);
    expect(JSON.stringify(session)).not.toContain(body.csrfToken);
    expect(updatedOwner.lastLoginAt).toEqual(currentTime);
    expect(JSON.stringify(body)).not.toContain("sessionToken");
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("sessionTokenHash");
    expect(JSON.stringify(body)).not.toContain("csrfTokenHash");
    expect(JSON.stringify(logEntries)).not.toContain(OWNER_PASSWORD);
    expect(JSON.stringify(logEntries)).not.toContain(sessionToken);
    expect(JSON.stringify(logEntries)).not.toContain(body.csrfToken);
  });

  it("creates a new token and allows multiple sessions for repeated successful logins", async () => {
    await createOwner();

    const first = await login(app);
    const second = await login(app);
    const sessions = await prisma.adminSession.findMany();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(sessions).toHaveLength(2);
    expect(getCookieValue(getSetCookie(first))).not.toBe(
      getCookieValue(getSetCookie(second)),
    );
    expect(first.json().csrfToken).not.toBe(second.json().csrfToken);
  });

  it("returns the same public failure for unknown, wrong password, and disabled users", async () => {
    const owner = await createOwner();
    await prisma.adminUser.update({
      data: { status: AdminUserStatus.DISABLED },
      where: { id: owner.id },
    });

    const unknown = await login(app, {
      email: "unknown@example.com",
      password: OWNER_PASSWORD,
    });
    await prisma.adminUser.update({
      data: { status: AdminUserStatus.ACTIVE },
      where: { id: owner.id },
    });
    const wrongPassword = await login(app, {
      email: OWNER_EMAIL,
      password: "wrong password value",
    });
    await prisma.adminUser.update({
      data: { status: AdminUserStatus.DISABLED },
      where: { id: owner.id },
    });
    const disabled = await login(app);

    for (const response of [unknown, wrongPassword, disabled]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: {
          code: "INVALID_CREDENTIALS",
          details: null,
          message: "Invalid credentials",
        },
      });
      expect(response.body).not.toContain("DISABLED");
      expect(response.body).not.toContain("USER_NOT_FOUND");
      expect(response.body).not.toContain("WRONG_PASSWORD");
    }
  });

  it("requires exact admin origin on login", async () => {
    await createOwner();

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: { origin: "http://localhost:3001.evil.test" },
      method: "POST",
      payload: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
      url: "/api/admin/auth/login",
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "CSRF_INVALID" },
    });
  });

  it("throttles after ten failed attempts for one normalized email", async () => {
    await createOwner();

    for (let i = 0; i < 10; i += 1) {
      const response = await login(app, {
        email: " OWNER@example.com ",
        password: "wrong password value",
      });
      expect(response.statusCode).toBe(401);
    }

    const throttled = await login(app, {
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
    });

    expect(throttled.statusCode).toBe(429);
    expect(throttled.json()).toMatchObject({
      error: { code: "TOO_MANY_LOGIN_ATTEMPTS" },
    });
  });

  it("returns /me for valid sessions and recovers CSRF without extending expiresAt", async () => {
    await createOwner();
    const loginResponse = await login(app);
    const cookie = getCookieHeader(getSetCookie(loginResponse));
    currentTime = new Date(currentTime.getTime() + 6 * 60 * 1000);

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie },
      method: "GET",
      url: "/api/admin/auth/me",
    });
    const session = await prisma.adminSession.findFirstOrThrow();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(loginResponse.json());
    expect(session.lastSeenAt).toEqual(currentTime);
    expect(session.expiresAt.toISOString()).toBe(
      loginResponse.json().session.expiresAt,
    );
  });

  it("allows CHECKIN_STAFF sessions to read /me and change their own password", async () => {
    const staff = await createStaff({ mustChangePassword: true });
    const loginResponse = await login(app, {
      email: "staff@example.com",
      password: OWNER_PASSWORD,
    });
    const cookie = getCookieHeader(getSetCookie(loginResponse));
    const { csrfToken } = loginResponse.json();

    const meBefore = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie },
      method: "GET",
      url: "/api/admin/auth/me",
    });
    const changePassword = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": csrfToken,
      },
      method: "POST",
      payload: {
        currentPassword: OWNER_PASSWORD,
        newPassword: "new correct horse password",
      },
      url: "/api/admin/auth/change-password",
    });
    const meAfter = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie },
      method: "GET",
      url: "/api/admin/auth/me",
    });
    const updatedStaff = await prisma.adminUser.findUniqueOrThrow({
      where: { id: staff.id },
    });
    const reloginOldPassword = await login(app, {
      email: "staff@example.com",
      password: OWNER_PASSWORD,
    });
    const reloginNewPassword = await login(app, {
      email: "staff@example.com",
      password: "new correct horse password",
    });

    expect(loginResponse.statusCode).toBe(200);
    expect(loginResponse.json().user).toEqual({
      email: "staff@example.com",
      id: staff.id,
      mustChangePassword: true,
      role: AdminRole.CHECKIN_STAFF,
    });
    expect(meBefore.statusCode).toBe(200);
    expect(changePassword.statusCode).toBe(204);
    expect(meAfter.statusCode).toBe(200);
    expect(meAfter.json().user.mustChangePassword).toBe(false);
    expect(updatedStaff.mustChangePassword).toBe(false);
    expect(reloginOldPassword.statusCode).toBe(401);
    expect(reloginNewPassword.statusCode).toBe(200);
  });

  it("revokes other sessions when an admin changes password", async () => {
    const staff = await createStaff();
    const sessionA = await createSession(staff.id);
    const sessionB = await createSession(staff.id);

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: `admin_session=${sessionA.sessionToken}`,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": sessionA.csrfToken,
      },
      method: "POST",
      payload: {
        currentPassword: OWNER_PASSWORD,
        newPassword: "new correct horse password",
      },
      url: "/api/admin/auth/change-password",
    });
    const currentSession = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: `admin_session=${sessionA.sessionToken}` },
      method: "GET",
      url: "/api/admin/auth/me",
    });
    const otherSession = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: `admin_session=${sessionB.sessionToken}` },
      method: "GET",
      url: "/api/admin/auth/me",
    });

    expect(response.statusCode).toBe(204);
    expect(currentSession.statusCode).toBe(200);
    expect(otherSession.statusCode).toBe(401);
  });

  it("rotates the existing OWNER with Argon2id without changing identity or business rows", async () => {
    const owner = await createOwner();
    const sessionA = await createSession(owner.id);
    const sessionB = await createSession(owner.id);
    const replacement = "synthetic owner replacement password";
    const before = {
      events: await prisma.event.count(),
      invitations: await prisma.invitation.count(),
      rsvps: await prisma.rSVP.count(),
    };
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          cookie: `admin_session=${sessionA.sessionToken}`,
          origin: ADMIN_ORIGIN,
          "x-csrf-token": sessionA.csrfToken,
        },
        method: "POST",
        payload: { currentPassword: OWNER_PASSWORD, newPassword: replacement },
        url: "/api/admin/auth/change-password",
      });
    expect(response.statusCode).toBe(204);
    const updated = await prisma.adminUser.findUniqueOrThrow({
      where: { id: owner.id },
    });
    expect(updated).toMatchObject({
      id: owner.id,
      email: owner.email,
      role: AdminRole.OWNER,
      status: AdminUserStatus.ACTIVE,
      mustChangePassword: false,
    });
    expect(updated.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(
      await passwordService.verifyPassword(updated.passwordHash, replacement),
    ).toBe(true);
    expect(await prisma.adminUser.count()).toBe(1);
    expect({
      events: await prisma.event.count(),
      invitations: await prisma.invitation.count(),
      rsvps: await prisma.rSVP.count(),
    }).toEqual(before);
    const oldLogin = await login(app);
    const freshLogin = await login(app, {
      email: OWNER_EMAIL,
      password: replacement,
    });
    expect(oldLogin.statusCode).toBe(401);
    expect(freshLogin.statusCode).toBe(200);
    const revoked = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: `admin_session=${sessionB.sessionToken}` },
        method: "GET",
        url: "/api/admin/auth/me",
      });
    expect(revoked.statusCode).toBe(401);
    for (const secret of [OWNER_PASSWORD, replacement, updated.passwordHash]) {
      expect(JSON.stringify(logEntries).includes(secret)).toBe(false);
      expect(response.body.includes(secret)).toBe(false);
    }
  });

  it("does not update lastSeenAt before the threshold", async () => {
    await createOwner();
    const loginResponse = await login(app);
    const cookie = getCookieHeader(getSetCookie(loginResponse));
    currentTime = new Date(currentTime.getTime() + 4 * 60 * 1000);

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie },
      method: "GET",
      url: "/api/admin/auth/me",
    });
    const session = await prisma.adminSession.findFirstOrThrow();

    expect(response.statusCode).toBe(200);
    expect(session.lastSeenAt).toBeNull();
  });

  it("maps missing, malformed, unknown, revoked, expired, idle-expired, and disabled sessions to UNAUTHENTICATED", async () => {
    const owner = await createOwner();
    const validButUnknownToken = tokenService.generateSessionTokens().sessionToken;
    const revoked = await createSession(owner.id, { revokedAt: currentTime });
    const expired = await createSession(owner.id, {
      expiresAt: new Date(currentTime.getTime() - 1),
    });
    const idle = await createSession(owner.id, {
      createdAt: new Date(currentTime.getTime() - 30 * 60 * 1000),
    });
    const disabled = await createSession(owner.id);
    await prisma.adminUser.update({
      data: { status: AdminUserStatus.DISABLED },
      where: { id: owner.id },
    });

    const cases = [
      undefined,
      "admin_session=bad",
      `admin_session=${validButUnknownToken}`,
      `admin_session=${revoked.sessionToken}`,
      `admin_session=${expired.sessionToken}`,
      `admin_session=${idle.sessionToken}`,
      `admin_session=${disabled.sessionToken}`,
    ];

    for (const cookie of cases) {
      const response = await app.getHttpAdapter().getInstance().inject({
        headers: cookie === undefined ? {} : { cookie },
        method: "GET",
        url: "/api/admin/auth/me",
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }
  });

  it("logs out only the current session and rejects replay", async () => {
    const owner = await createOwner();
    const sessionA = await createSession(owner.id);
    const sessionB = await createSession(owner.id);

    const response = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: `admin_session=${sessionA.sessionToken}`,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": sessionA.csrfToken,
      },
      method: "POST",
      url: "/api/admin/auth/logout",
    });
    const sessions = await prisma.adminSession.findMany({
      orderBy: { createdAt: "asc" },
    });

    expect(response.statusCode).toBe(204);
    expect(getSetCookie(response)).toContain("Max-Age=0");
    expect(sessions.filter((session) => session.revokedAt !== null)).toHaveLength(
      1,
    );

    const replay = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: `admin_session=${sessionA.sessionToken}`,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": sessionA.csrfToken,
      },
      method: "POST",
      url: "/api/admin/auth/logout",
    });
    const stillValid = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: `admin_session=${sessionB.sessionToken}` },
      method: "GET",
      url: "/api/admin/auth/me",
    });

    expect(replay.statusCode).toBe(401);
    expect(stillValid.statusCode).toBe(200);
  });

  it("rejects cross-session CSRF and wrong origin on unsafe authenticated requests", async () => {
    const owner = await createOwner();
    const sessionA = await createSession(owner.id);
    const sessionB = await createSession(owner.id);

    const crossCsrf = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: `admin_session=${sessionA.sessionToken}`,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": sessionB.csrfToken,
      },
      method: "POST",
      url: "/api/admin/auth/logout",
    });
    const wrongOrigin = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: `admin_session=${sessionA.sessionToken}`,
        origin: "http://localhost:3001.evil.test",
        "x-csrf-token": sessionA.csrfToken,
      },
      method: "POST",
      url: "/api/admin/auth/logout",
    });

    expect(crossCsrf.statusCode).toBe(403);
    expect(crossCsrf.json()).toMatchObject({
      error: { code: "CSRF_INVALID" },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json()).toMatchObject({
      error: { code: "CSRF_INVALID" },
    });
  });
});
