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
import { getDatabaseUrl } from "../database/database-url.js";
import {
  AdminRole,
  AdminUserStatus,
  PrismaClient,
} from "../generated/prisma/client.js";
import { AdminPasswordService } from "./password.service.js";
import { AdminSessionTokenService } from "./session-token.service.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const OWNER_EMAIL = "owner-staff@example.com";
const OWNER_PASSWORD = "correct horse battery staple";
const STAFF_EMAIL = "checkin.staff@example.com";
const STAFF_PASSWORD = "staff correct horse battery";

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const passwordService = new AdminPasswordService();
const tokenService = new AdminSessionTokenService();

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

async function createUserAndSession(input: {
  email: string;
  mustChangePassword?: boolean;
  password: string;
  role: AdminRole;
  status?: AdminUserStatus;
}) {
  const user = await prisma.adminUser.create({
    data: {
      email: input.email,
      mustChangePassword: input.mustChangePassword ?? false,
      passwordHash: await passwordService.hashPassword(input.password),
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

async function login(app: NestFastifyApplication, payload: {
  email: string;
  password: string;
}) {
  return app.getHttpAdapter().getInstance().inject({
    headers: { origin: ADMIN_ORIGIN },
    method: "POST",
    payload,
    url: "/api/admin/auth/login",
  });
}

function getSetCookie(response: { headers: Record<string, unknown> }): string {
  const value = response.headers["set-cookie"];

  if (Array.isArray(value)) {
    return String(value[0]);
  }

  return String(value);
}

function getCookieHeader(response: { headers: Record<string, unknown> }): string {
  return getSetCookie(response).split(";")[0]!;
}

describe("admin staff HTTP integration", () => {
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
    await cleanAdminAuth();
  });

  afterAll(async () => {
    await cleanAdminAuth();
    await app.close();
    await prisma.$disconnect();
  });

  it("lets OWNER provision, list, disable, reactivate, and reset CHECKIN_STAFF accounts", async () => {
    const ownerSession = await createUserAndSession({
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      role: AdminRole.OWNER,
    });

    const created = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: ownerSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": ownerSession.csrfToken,
      },
      method: "POST",
      payload: { email: ` ${STAFF_EMAIL.toUpperCase()} ` },
      url: "/api/admin/staff",
    });
    const createdBody = created.json();

    expect(created.statusCode).toBe(201);
    expect(createdBody).toEqual({
      staff: {
        email: STAFF_EMAIL,
        id: expect.any(String),
        mustChangePassword: true,
        role: AdminRole.CHECKIN_STAFF,
        status: AdminUserStatus.ACTIVE,
      },
      temporaryPassword: expect.any(String),
    });
    expect(JSON.stringify(createdBody)).not.toContain("passwordHash");

    const staffLogin = await login(app, {
      email: STAFF_EMAIL,
      password: createdBody.temporaryPassword,
    });

    expect(staffLogin.statusCode).toBe(200);
    expect(staffLogin.json().user).toMatchObject({
      mustChangePassword: true,
      role: AdminRole.CHECKIN_STAFF,
    });
    const staffCookie = getCookieHeader(staffLogin);
    const staffCsrfToken = staffLogin.json().csrfToken;

    const duplicate = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: ownerSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": ownerSession.csrfToken,
      },
      method: "POST",
      payload: { email: STAFF_EMAIL },
      url: "/api/admin/staff",
    });
    const forgedOwnerRole = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: ownerSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": ownerSession.csrfToken,
      },
      method: "POST",
      payload: { email: "forged-role@example.com", role: AdminRole.OWNER },
      url: "/api/admin/staff",
    });

    expect(duplicate.statusCode).toBe(409);
    expect(forgedOwnerRole.statusCode).toBe(400);
    await expect(
      prisma.adminUser.findUnique({
        where: { email: "forged-role@example.com" },
      }),
    ).resolves.toBeNull();

    const list = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: ownerSession.cookie },
      method: "GET",
      url: "/api/admin/staff",
    });

    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      items: [
        {
          createdAt: expect.any(String),
          email: STAFF_EMAIL,
          id: createdBody.staff.id,
          lastLoginAt: expect.any(String),
          mustChangePassword: true,
          role: AdminRole.CHECKIN_STAFF,
          status: AdminUserStatus.ACTIVE,
        },
      ],
      page: { number: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    });

    const disable = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: ownerSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": ownerSession.csrfToken,
      },
      method: "PATCH",
      payload: { status: AdminUserStatus.DISABLED },
      url: `/api/admin/staff/${createdBody.staff.id}`,
    });
    const disabledLogin = await login(app, {
      email: STAFF_EMAIL,
      password: createdBody.temporaryPassword,
    });
    const disabledOldSession = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: staffCookie },
      method: "GET",
      url: "/api/admin/auth/me",
    });

    expect(disable.statusCode).toBe(200);
    expect(disable.json().status).toBe(AdminUserStatus.DISABLED);
    expect(disabledOldSession.statusCode).toBe(401);
    expect(disabledLogin.statusCode).toBe(401);

    const reactivate = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: ownerSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": ownerSession.csrfToken,
      },
      method: "PATCH",
      payload: { status: AdminUserStatus.ACTIVE },
      url: `/api/admin/staff/${createdBody.staff.id}`,
    });
    const reset = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: ownerSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": ownerSession.csrfToken,
      },
      method: "POST",
      url: `/api/admin/staff/${createdBody.staff.id}/reset-password`,
    });

    expect(reactivate.statusCode).toBe(200);
    expect(reactivate.json().status).toBe(AdminUserStatus.ACTIVE);
    expect(reset.statusCode).toBe(200);
    expect(reset.json().staff.mustChangePassword).toBe(true);
    expect(reset.json().temporaryPassword).not.toBe(
      createdBody.temporaryPassword,
    );

    const oldPassword = await login(app, {
      email: STAFF_EMAIL,
      password: createdBody.temporaryPassword,
    });
    const newPassword = await login(app, {
      email: STAFF_EMAIL,
      password: reset.json().temporaryPassword,
    });
    const resetOldSession = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: staffCookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": staffCsrfToken,
      },
      method: "POST",
      payload: {
        currentPassword: createdBody.temporaryPassword,
        newPassword: "stale staff session password",
      },
      url: "/api/admin/auth/change-password",
    });
    const updateOwnerStatus = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: ownerSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": ownerSession.csrfToken,
      },
      method: "PATCH",
      payload: { status: AdminUserStatus.DISABLED },
      url: `/api/admin/staff/${ownerSession.user.id}`,
    });
    const resetOwnerPassword = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: ownerSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": ownerSession.csrfToken,
      },
      method: "POST",
      url: `/api/admin/staff/${ownerSession.user.id}/reset-password`,
    });

    expect(oldPassword.statusCode).toBe(401);
    expect(newPassword.statusCode).toBe(200);
    expect(resetOldSession.statusCode).toBe(401);
    expect(updateOwnerStatus.statusCode).toBe(409);
    expect(resetOwnerPassword.statusCode).toBe(409);
  });

  it("keeps CHECKIN_STAFF out of OWNER-only admin routes", async () => {
    const staffSession = await createUserAndSession({
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
      role: AdminRole.CHECKIN_STAFF,
    });
    const id = "11111111-1111-4111-8111-111111111111";

    const me = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: staffSession.cookie },
      method: "GET",
      url: "/api/admin/auth/me",
    });
    const ownerOnlyRoutes = [
      ["GET", "/api/admin/dashboard"],
      ["GET", "/api/admin/events"],
      ["GET", "/api/admin/invitations"],
      ["GET", `/api/admin/invitations/${id}`],
      ["GET", `/api/admin/invitations/${id}/public-url`],
      ["GET", `/api/admin/invitations/${id}/messages`],
      ["POST", "/api/admin/invitations"],
      ["PATCH", `/api/admin/invitations/${id}`],
      ["POST", `/api/admin/invitations/${id}/archive`],
      ["POST", `/api/admin/invitations/${id}/regenerate-token`],
      ["POST", `/api/admin/invitations/${id}/invitees`],
      ["PUT", `/api/admin/invitations/${id}/events`],
      ["PUT", `/api/admin/invitations/${id}/rsvp`],
      ["PATCH", `/api/admin/invitees/${id}`],
      ["DELETE", `/api/admin/invitees/${id}`],
      ["GET", "/api/admin/rsvps"],
      ["GET", `/api/admin/rsvps/${id}`],
      ["GET", "/api/admin/messages"],
      ["PATCH", `/api/admin/messages/${id}`],
      ["POST", "/api/admin/imports/guest/validate"],
      ["POST", "/api/admin/imports/guest/commit"],
      ["GET", "/api/admin/staff"],
      ["POST", "/api/admin/staff"],
      ["PATCH", `/api/admin/staff/${id}`],
      ["POST", `/api/admin/staff/${id}/reset-password`],
    ] as const;
    const before = {
      adminUsers: await prisma.adminUser.count(),
      invitations: await prisma.invitation.count(),
      sessions: await prisma.adminSession.count(),
    };

    expect(me.statusCode).toBe(200);
    expect(me.json().user.role).toBe(AdminRole.CHECKIN_STAFF);

    for (const [method, url] of ownerOnlyRoutes) {
      const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
      const response = await app.getHttpAdapter().getInstance().inject({
        headers: unsafe
          ? {
              cookie: staffSession.cookie,
              origin: ADMIN_ORIGIN,
              "x-csrf-token": staffSession.csrfToken,
            }
          : { cookie: staffSession.cookie },
        method,
        payload: unsafe ? {} : undefined,
        url,
      });

      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "FORBIDDEN", details: null },
      });
      expect(response.body).not.toContain("displayName");
      expect(response.body).not.toContain("passwordHash");
    }

    await expect(prisma.adminUser.count()).resolves.toBe(before.adminUsers);
    await expect(prisma.invitation.count()).resolves.toBe(before.invitations);
    await expect(prisma.adminSession.count()).resolves.toBe(before.sessions);
  });

  it("restricts must-change-password sessions to session and password routes", async () => {
    const staffSession = await createUserAndSession({
      email: STAFF_EMAIL,
      mustChangePassword: true,
      password: STAFF_PASSWORD,
      role: AdminRole.CHECKIN_STAFF,
    });

    const me = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: staffSession.cookie },
      method: "GET",
      url: "/api/admin/auth/me",
    });
    const dashboard = await app.getHttpAdapter().getInstance().inject({
      headers: { cookie: staffSession.cookie },
      method: "GET",
      url: "/api/admin/dashboard",
    });
    const changePassword = await app.getHttpAdapter().getInstance().inject({
      headers: {
        cookie: staffSession.cookie,
        origin: ADMIN_ORIGIN,
        "x-csrf-token": staffSession.csrfToken,
      },
      method: "POST",
      payload: {
        currentPassword: STAFF_PASSWORD,
        newPassword: "staff replacement password",
      },
      url: "/api/admin/auth/change-password",
    });

    expect(me.statusCode).toBe(200);
    expect(me.json().user.mustChangePassword).toBe(true);
    expect(dashboard.statusCode).toBe(403);
    expect(changePassword.statusCode).toBe(204);
  });
});
