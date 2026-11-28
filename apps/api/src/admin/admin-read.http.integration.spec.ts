import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { NestFactory } from "@nestjs/core";
import { ModulesContainer } from "@nestjs/core";
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
  CheckinPassStatus,
  InviteeCategory,
  InvitationStatus,
  PrismaClient,
  RSVPAttendeeType,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { CredentialService } from "../security/credential.service.js";
import { AdminPasswordService } from "../auth/password.service.js";
import { AdminSessionTokenService } from "../auth/session-token.service.js";

const ADMIN_ORIGIN = "http://localhost:3001";
const PUBLIC_ORIGIN = "http://localhost:3000";
const OWNER_EMAIL = "owner-read@example.com";
const OWNER_PASSWORD = "correct horse battery staple";
const CREDENTIAL_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const passwordService = new AdminPasswordService();
const tokenService = new AdminSessionTokenService();

type AdminRoute = {
  method: AdminHttpMethod;
  path: string;
};

type AdminHttpMethod =
  "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizeRoutePath(...parts: string[]): string {
  return `/${parts
    .flatMap((part) => part.split("/"))
    .filter((part) => part.length > 0)
    .join("/")}`;
}

function discoverAdminRoutes(app: NestFastifyApplication): AdminRoute[] {
  const modules = app.get(ModulesContainer, { strict: false });
  const routes: AdminRoute[] = [];
  const methodNames = {
    [RequestMethod.DELETE]: "DELETE",
    [RequestMethod.GET]: "GET",
    [RequestMethod.HEAD]: "HEAD",
    [RequestMethod.OPTIONS]: "OPTIONS",
    [RequestMethod.PATCH]: "PATCH",
    [RequestMethod.POST]: "POST",
    [RequestMethod.PUT]: "PUT",
  } as Partial<Record<RequestMethod, AdminHttpMethod>>;

  for (const moduleRef of modules.values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype;

      if (controller === undefined || controller === null) {
        continue;
      }

      const controllerPaths = asArray<string>(
        Reflect.getMetadata(PATH_METADATA, controller as object),
      );
      const prototype = (controller as { prototype: Record<string, unknown> })
        .prototype;

      for (const key of Object.getOwnPropertyNames(prototype)) {
        if (key === "constructor" || typeof prototype[key] !== "function") {
          continue;
        }

        const handler = prototype[key] as object;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        const routePaths = asArray<string>(
          Reflect.getMetadata(PATH_METADATA, handler),
        );
        const methodName =
          method === undefined ? undefined : methodNames[method];

        if (methodName === undefined) {
          continue;
        }

        for (const controllerPath of controllerPaths) {
          for (const routePath of routePaths) {
            const path = normalizeRoutePath(controllerPath, routePath);

            if (path.startsWith("/api/admin/")) {
              routes.push({ method: methodName, path });
            }
          }
        }
      }
    }
  }

  return routes.sort((left, right) =>
    `${left.method} ${left.path}`.localeCompare(
      `${right.method} ${right.path}`,
    ),
  );
}

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

async function createOwnerAndSession(
  input: { role?: AdminRole; mustChangePassword?: boolean } = {},
) {
  const owner = await prisma.adminUser.create({
    data: {
      email:
        input.role || input.mustChangePassword
          ? `inventory-${randomUUID()}@example.com`
          : OWNER_EMAIL,
      role: input.role ?? AdminRole.OWNER,
      mustChangePassword: input.mustChangePassword ?? false,
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
    sessionToken: tokens.sessionToken,
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
    displayName: string;
    eventIds?: string[];
    greetingName?: string | null;
    invitees?: Array<{
      category?: InviteeCategory;
      fullName: string;
      label?: string | null;
    }>;
    notes?: string | null;
    openCount?: number;
    publicTokenVersion?: number;
    rsvp?: RSVPStatus;
    status?: InvitationStatus;
  },
) {
  const id = randomUUID();
  const version = input.publicTokenVersion ?? 1;
  const publicCredential = credentialService.deriveCredential({
    namespace: "invitation",
    stableId: id,
    version,
  });
  const invitation = await prisma.invitation.create({
    data: {
      displayName: input.displayName,
      greetingName: input.greetingName ?? null,
      archivedAt:
        input.status === InvitationStatus.ARCHIVED
          ? new Date("2026-09-30T04:00:00.000Z")
          : null,
      id,
      lastOpenedAt:
        input.openCount !== undefined && input.openCount > 0
          ? new Date("2026-09-30T01:00:00.000Z")
          : null,
      notes: input.notes ?? null,
      openCount: input.openCount ?? 0,
      publicTokenHash: credentialService.hashCredential(publicCredential),
      publicTokenVersion: version,
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

  if (input.invitees !== undefined) {
    await prisma.invitee.createMany({
      data: input.invitees.map((invitee, index) => ({
        category: invitee.category ?? InviteeCategory.ADULT,
        displayOrder: index,
        fullName: invitee.fullName,
        invitationId: invitation.id,
        label: invitee.label,
      })),
    });
  }

  if (input.rsvp !== undefined) {
    await prisma.rSVP.create({
      data: {
        dietaryNotes: input.rsvp === RSVPStatus.ACCEPTED ? "Vegetarian" : null,
        guestNote: input.rsvp === RSVPStatus.ACCEPTED ? "See you there" : null,
        invitationId: invitation.id,
        status: input.rsvp,
        submittedAt: new Date("2026-09-30T02:00:00.000Z"),
      },
    });
  }

  return { invitation, publicCredential };
}

function materializeRoute(path: string, invitationId: string): string {
  return path.replace(":invitationId", invitationId);
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

describe("admin read HTTP integration", () => {
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

  it("inventories all admin routes and enforces shared admin security", async () => {
    const event = await createEvent({ displayOrder: 1 });
    const { invitation } = await createInvitation(credentialService, {
      displayName: "Inventory Household",
      eventIds: [event.id],
    });
    const session = await createOwnerAndSession();
    const routes = discoverAdminRoutes(app);
    const routeNames = routes.map((route) => `${route.method} ${route.path}`);

    expect(routes).toHaveLength(66);
    expect(routeNames).toEqual(
      expect.arrayContaining([
        "GET /api/admin/reception/search",
        "GET /api/admin/reception/actions/:operationId",
        "GET /api/admin/reception/households/:id",
        "GET /api/admin/reception/operations/:operationId",
        "GET /api/admin/reception/statistics",
        "POST /api/admin/reception/validate",
        "POST /api/admin/reception/walkins",
        "POST /api/admin/reception/arrivals",
        "POST /api/admin/reception/corrections",
        "POST /api/admin/reception/exceptions",
        "POST /api/admin/invitations",
        "POST /api/admin/invitations/:invitationId/invitees",
        "DELETE /api/admin/invitees/:inviteeId",
        "GET /api/admin/messages",
        "GET /api/admin/staff",
        "GET /api/admin/invitations/:invitationId/messages",
        "PATCH /api/admin/messages/:messageId",
        "PATCH /api/admin/staff/:staffId",
        "POST /api/admin/auth/change-password",
        "GET /api/admin/checkin/events",
        "GET /api/admin/checkin/search",
        "POST /api/admin/checkin/confirm",
        "POST /api/admin/checkin/manual-confirm",
        "POST /api/admin/checkin/manual-status",
        "POST /api/admin/checkin/validate",
        "POST /api/admin/imports/guest/commit",
        "POST /api/admin/imports/guest/validate",
        "POST /api/admin/reception/arrivals",
        "POST /api/admin/reception/corrections",
        "POST /api/admin/reception/exceptions",
        "POST /api/admin/reception/validate",
        "POST /api/admin/reception/walkins",
        "POST /api/admin/staff",
        "POST /api/admin/staff/:staffId/reset-password",
      ]),
    );
    expect(routeNames).toEqual([
      "DELETE /api/admin/event-content/:eventId/assets/:assetId",
      "DELETE /api/admin/invitees/:inviteeId",
      "GET /api/admin/auth/me",
      "GET /api/admin/checkin/events",
      "GET /api/admin/checkin/search",
      "GET /api/admin/dashboard",
      "GET /api/admin/event-content/:eventId",
      "GET /api/admin/event-content/:eventId/assets/:assetId",
      "GET /api/admin/event-management",
      "GET /api/admin/events",
      "GET /api/admin/imports/guest/template",
      "GET /api/admin/invitations",
      "GET /api/admin/invitations/:invitationId",
      "GET /api/admin/invitations/:invitationId/messages",
      "GET /api/admin/invitations/:invitationId/public-url",
      "GET /api/admin/messages",
      "GET /api/admin/reception/actions/:operationId",
      "GET /api/admin/reception/households/:id",
      "GET /api/admin/reception/operations/:operationId",
      "GET /api/admin/reception/search",
      "GET /api/admin/reception/statistics",
      "GET /api/admin/reports/catering/live",
      "GET /api/admin/reports/catering/snapshots",
      "GET /api/admin/reports/catering/snapshots/:version",
      "GET /api/admin/reports/catering/snapshots/:version/export",
      "GET /api/admin/reports/export",
      "GET /api/admin/reports/households",
      "GET /api/admin/reports/summary",
      "GET /api/admin/rsvp-policy",
      "GET /api/admin/rsvps",
      "GET /api/admin/rsvps/:rsvpId",
      "GET /api/admin/staff",
      "PATCH /api/admin/invitations/:invitationId",
      "PATCH /api/admin/invitees/:inviteeId",
      "PATCH /api/admin/messages/:messageId",
      "PATCH /api/admin/staff/:staffId",
      "POST /api/admin/auth/change-password",
      "POST /api/admin/auth/login",
      "POST /api/admin/auth/logout",
      "POST /api/admin/checkin/confirm",
      "POST /api/admin/checkin/manual-confirm",
      "POST /api/admin/checkin/manual-status",
      "POST /api/admin/checkin/validate",
      "POST /api/admin/event-content/:eventId/assets",
      "POST /api/admin/event-content/:eventId/hide",
      "POST /api/admin/event-content/:eventId/publish",
      "POST /api/admin/event-management",
      "POST /api/admin/imports/guest/commit",
      "POST /api/admin/imports/guest/validate",
      "POST /api/admin/invitations",
      "POST /api/admin/invitations/:invitationId/archive",
      "POST /api/admin/invitations/:invitationId/invitees",
      "POST /api/admin/invitations/:invitationId/regenerate-token",
      "POST /api/admin/reception/arrivals",
      "POST /api/admin/reception/corrections",
      "POST /api/admin/reception/exceptions",
      "POST /api/admin/reception/validate",
      "POST /api/admin/reception/walkins",
      "POST /api/admin/reports/catering/snapshots",
      "POST /api/admin/staff",
      "POST /api/admin/staff/:staffId/reset-password",
      "PUT /api/admin/event-content/:eventId",
      "PUT /api/admin/event-management/:eventId",
      "PUT /api/admin/invitations/:invitationId/events",
      "PUT /api/admin/invitations/:invitationId/rsvp",
      "PUT /api/admin/rsvp-policy",
    ]);

    for (const route of routes.filter(
      (candidate) =>
        !(
          candidate.method === "POST" &&
          candidate.path === "/api/admin/auth/login"
        ),
    )) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers:
            route.method === "POST"
              ? { origin: ADMIN_ORIGIN, "x-csrf-token": session.csrfToken }
              : {},
          method: route.method,
          url: materializeRoute(route.path, invitation.id),
        });

      expect(response.statusCode, `${route.method} ${route.path}`).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }

    const login = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { origin: ADMIN_ORIGIN },
        method: "POST",
        payload: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
        url: "/api/admin/auth/login",
      });
    expect(login.statusCode).toBe(200);

    const unsafeRoutes = routes.filter(
      (route) =>
        ["POST", "PUT", "PATCH", "DELETE"].includes(route.method) &&
        !(route.method === "POST" && route.path === "/api/admin/auth/login"),
    );
    expect(
      unsafeRoutes.map((route) => `${route.method} ${route.path}`),
    ).toEqual([
      "DELETE /api/admin/event-content/:eventId/assets/:assetId",
      "DELETE /api/admin/invitees/:inviteeId",
      "PATCH /api/admin/invitations/:invitationId",
      "PATCH /api/admin/invitees/:inviteeId",
      "PATCH /api/admin/messages/:messageId",
      "PATCH /api/admin/staff/:staffId",
      "POST /api/admin/auth/change-password",
      "POST /api/admin/auth/logout",
      "POST /api/admin/checkin/confirm",
      "POST /api/admin/checkin/manual-confirm",
      "POST /api/admin/checkin/manual-status",
      "POST /api/admin/checkin/validate",
      "POST /api/admin/event-content/:eventId/assets",
      "POST /api/admin/event-content/:eventId/hide",
      "POST /api/admin/event-content/:eventId/publish",
      "POST /api/admin/event-management",
      "POST /api/admin/imports/guest/commit",
      "POST /api/admin/imports/guest/validate",
      "POST /api/admin/invitations",
      "POST /api/admin/invitations/:invitationId/archive",
      "POST /api/admin/invitations/:invitationId/invitees",
      "POST /api/admin/invitations/:invitationId/regenerate-token",
      "POST /api/admin/reception/arrivals",
      "POST /api/admin/reception/corrections",
      "POST /api/admin/reception/exceptions",
      "POST /api/admin/reception/validate",
      "POST /api/admin/reception/walkins",
      "POST /api/admin/reports/catering/snapshots",
      "POST /api/admin/staff",
      "POST /api/admin/staff/:staffId/reset-password",
      "PUT /api/admin/event-content/:eventId",
      "PUT /api/admin/event-management/:eventId",
      "PUT /api/admin/invitations/:invitationId/events",
      "PUT /api/admin/invitations/:invitationId/rsvp",
      "PUT /api/admin/rsvp-policy",
    ]);

    for (const route of unsafeRoutes) {
      const missingCsrf = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { cookie: session.cookie, origin: ADMIN_ORIGIN },
          method: route.method,
          url: materializeRoute(route.path, invitation.id),
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
          method: route.method,
          url: materializeRoute(route.path, invitation.id),
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
          method: route.method,
          url: materializeRoute(route.path, invitation.id),
        });

      for (const response of [missingCsrf, wrongCsrf, badOrigin]) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({
          error: { code: "CSRF_INVALID" },
        });
      }
    }

    for (const path of [
      "/api/admin/dashboard",
      "/api/admin/event-management",
      `/api/admin/invitations/${invitation.id}`,
    ]) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { cookie: session.cookie },
          method: "GET",
          url: path,
        });

      expect(response.statusCode, path).toBe(200);
    }
  });

  it("keeps Event Management OWNER-only and enforces forced password change", async () => {
    const staff = await createOwnerAndSession({
      role: AdminRole.CHECKIN_STAFF,
    });
    const forcedOwner = await createOwnerAndSession({
      mustChangePassword: true,
    });
    const event = await createEvent({ displayOrder: 1 });
    for (const session of [staff, forcedOwner]) {
      for (const [method, url] of [
        ["GET", "/api/admin/event-management"],
        ["POST", "/api/admin/event-management"],
        ["PUT", `/api/admin/event-management/${event.id}`],
      ] as const) {
        const response = await app
          .getHttpAdapter()
          .getInstance()
          .inject({
            method,
            url,
            headers: {
              cookie: session.cookie,
              origin: ADMIN_ORIGIN,
              "x-csrf-token": session.csrfToken,
            },
          });
        expect(response.statusCode, `${method} ${url}`).toBe(403);
        expect(response.json().error.code).toBe("FORBIDDEN");
      }
    }
  });

  it("returns dashboard and event catalog read projections", async () => {
    const session = await createOwnerAndSession();
    const ceremony = await createEvent({
      displayOrder: 2,
      name: "Ceremony",
      slug: "ceremony",
    });
    const reception = await createEvent({
      displayOrder: 1,
      isActive: false,
      name: "Reception",
      slug: "reception",
    });
    const startsAt = "2027-01-02T03:00:00.000Z";
    const endsAt = "2027-01-02T05:00:00.000Z";
    await prisma.event.update({
      where: { id: ceremony.id },
      data: { startsAt, endsAt },
    });
    await createInvitation(credentialService, {
      displayName: "No RSVP",
    });
    await createInvitation(credentialService, {
      displayName: "Opened",
      openCount: 2,
    });
    await createInvitation(credentialService, {
      displayName: "Pending row",
      rsvp: RSVPStatus.PENDING,
    });
    const acceptedA = await createInvitation(credentialService, {
      displayName: "Accepted A",
      eventIds: [ceremony.id, reception.id],
      rsvp: RSVPStatus.ACCEPTED,
    });
    const acceptedB = await createInvitation(credentialService, {
      displayName: "Accepted B",
      eventIds: [reception.id],
      rsvp: RSVPStatus.ACCEPTED,
    });
    await createInvitation(credentialService, {
      displayName: "Declined",
      rsvp: RSVPStatus.DECLINED,
    });
    await createInvitation(credentialService, {
      displayName: "Archived accepted",
      rsvp: RSVPStatus.ACCEPTED,
      status: InvitationStatus.ARCHIVED,
    });
    const rsvps = await prisma.rSVP.findMany({
      where: {
        invitationId: {
          in: [acceptedA.invitation.id, acceptedB.invitation.id],
        },
      },
      orderBy: { invitationId: "asc" },
    });
    await prisma.rSVPEventSelection.createMany({
      data: [
        {
          attending: true,
          eventId: ceremony.id,
          expectedAttendeeCount: 2,
          rsvpId: rsvps.find(
            (rsvp) => rsvp.invitationId === acceptedA.invitation.id,
          )!.id,
        },
        {
          attending: true,
          eventId: reception.id,
          expectedAttendeeCount: 3,
          rsvpId: rsvps.find(
            (rsvp) => rsvp.invitationId === acceptedA.invitation.id,
          )!.id,
        },
        {
          attending: true,
          eventId: reception.id,
          expectedAttendeeCount: 4,
          rsvpId: rsvps.find(
            (rsvp) => rsvp.invitationId === acceptedB.invitation.id,
          )!.id,
        },
      ],
    });

    const dashboard = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/dashboard",
      });
    const events = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/events",
      });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toEqual({
      expectedByEvent: [
        {
          event: {
            id: reception.id,
            name: "Reception",
            slug: "reception",
          },
          expectedAttendeeCount: 7,
        },
        {
          event: {
            id: ceremony.id,
            name: "Ceremony",
            slug: "ceremony",
          },
          expectedAttendeeCount: 2,
        },
      ],
      invitations: {
        active: 6,
        archived: 1,
        openedActive: 1,
      },
      rsvp: {
        accepted: 2,
        declined: 1,
        pending: 3,
      },
    });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toEqual({
      events: [
        {
          displayOrder: 1,
          id: reception.id,
          isActive: false,
          name: "Reception",
          slug: "reception",
          startsAt: null,
          endsAt: null,
          venueName: null,
          address: null,
        },
        {
          displayOrder: 2,
          id: ceremony.id,
          isActive: true,
          name: "Ceremony",
          slug: "ceremony",
          startsAt,
          endsAt,
          venueName: null,
          address: null,
        },
      ],
    });
  });

  it("lists invitations with shared pagination, sorting, filters, bounded search, and safe DTOs", async () => {
    const session = await createOwnerAndSession();
    await createInvitation(credentialService, {
      displayName: "Smith Family",
      greetingName: "The Smiths",
      invitees: [{ fullName: "John Smith" }, { fullName: "Jane Smith" }],
      notes: "private notes",
      rsvp: RSVPStatus.ACCEPTED,
    });
    await createInvitation(credentialService, {
      displayName: "Archer Family",
      greetingName: "Archers",
      rsvp: RSVPStatus.DECLINED,
      status: InvitationStatus.ARCHIVED,
    });
    const twins = await createInvitation(credentialService, {
      displayName: "Twin Household",
      greetingName: "Twins",
      invitees: [{ fullName: "Twin One" }, { fullName: "Twin Two" }],
      publicTokenVersion: 7,
    });

    const list = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/invitations?page=1&pageSize=2&sortBy=displayName&sortOrder=asc",
      });
    const searchInvitee = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/invitations?search=twin&pageSize=100",
      });
    const pending = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/invitations?rsvpStatus=PENDING",
      });
    const invalidPage = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/invitations?pageSize=101",
      });
    const invalidSort = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: "/api/admin/invitations?sortBy=notes",
      });
    const tooLongSearch = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations?search=${encodeURIComponent("🙂".repeat(101))}`,
      });
    const noSensitiveSearch = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations?search=${twins.invitation.id}`,
      });

    expect(list.statusCode).toBe(200);
    expect(
      list
        .json()
        .items.map((item: { displayName: string }) => item.displayName),
    ).toEqual(["Archer Family", "Smith Family"]);
    expect(list.json().page).toEqual({
      number: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
    });
    expect(searchInvitee.statusCode).toBe(200);
    expect(searchInvitee.json().items).toHaveLength(1);
    expect(searchInvitee.json().items[0]).toMatchObject({
      displayName: "Twin Household",
      inviteeCount: 2,
      rsvpStatus: "PENDING",
    });
    expect(searchInvitee.body).not.toContain("publicTokenVersion");
    expect(searchInvitee.body).not.toContain("private notes");
    expect(pending.json().items.map((item: { id: string }) => item.id)).toEqual(
      [twins.invitation.id],
    );
    expect(noSensitiveSearch.json().items).toHaveLength(0);

    for (const response of [invalidPage, invalidSort, tooLongSearch]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
  });

  it("filters across the whole wedding and keeps the active overview independent of pagination", async () => {
    const session = await createOwnerAndSession();
    const a = await createEvent({
      displayOrder: 1,
      name: "Blessing",
      slug: "dynamic-a",
    });
    const b = await createEvent({
      displayOrder: 2,
      name: "Dinner",
      slug: "dynamic-b",
    });
    const c = await createEvent({
      displayOrder: 3,
      name: "After party",
      slug: "dynamic-c",
    });
    const d = await createEvent({
      displayOrder: 4,
      name: "Former session",
      isActive: false,
    });
    const unused = await createEvent({
      displayOrder: 5,
      name: "No invitations yet",
    });
    async function household(
      name: string,
      eventIds: string[],
      inviteeCount: number,
      extra: Partial<Parameters<typeof createInvitation>[1]> = {},
    ) {
      return createInvitation(credentialService, {
        displayName: name,
        eventIds,
        invitees: Array.from({ length: inviteeCount }, (_, index) => ({
          fullName: `${name} named ${index + 1}`,
        })),
        ...extra,
      });
    }
    await household("01 Ceremony only", [a.id], 2, {
      openCount: 2,
      rsvp: RSVPStatus.ACCEPTED,
    });
    await household("02 Both", [b.id, a.id], 3, { openCount: 1 });
    await household("03 Legacy", [c.id, a.id, b.id], 2, {
      openCount: 5,
      rsvp: RSVPStatus.ACCEPTED,
    });
    await household("04 Archived", [a.id], 3, {
      openCount: 4,
      status: InvitationStatus.ARCHIVED,
    });
    await household("05 Reception only", [b.id], 1, {
      rsvp: RSVPStatus.DECLINED,
    });
    await household("06 Alternate pair", [b.id, c.id], 1, {
      rsvp: RSVPStatus.PENDING,
    });
    await household("07 Retained inactive", [d.id], 1, {
      openCount: 1,
      rsvp: RSVPStatus.DECLINED,
    });
    await household("08 No sessions", [], 1);
    const outside = await household("09 Outside first page", [a.id], 1, {
      invitees: [{ fullName: "Last Traveler" }],
    });
    const list = (query: string) =>
      app.inject({
        url: `/api/admin/invitations?sortBy=displayName&sortOrder=asc&${query}`,
        headers: { cookie: session.cookie },
      });
    const expectedOverview = {
      households: 8,
      namedGuests: 12,
      opened: 4,
      unopened: 4,
      rsvp: { accepted: 2, pending: 4, declined: 2 },
      events: [a, b, c, d, unused].map((event, index) => ({
        id: event.id,
        slug: event.slug,
        name: event.name,
        isActive: event.isActive,
        displayOrder: event.displayOrder,
        eligibleHouseholds: [4, 4, 2, 1, 0][index],
      })),
    };
    for (const [query, names] of [
      [
        `eligibility=includes&eventId=${a.id}`,
        [
          "01 Ceremony only",
          "02 Both",
          "03 Legacy",
          "04 Archived",
          "09 Outside first page",
        ],
      ],
      [
        `eligibility=exact&eventId=${a.id}`,
        ["01 Ceremony only", "04 Archived", "09 Outside first page"],
      ],
      [
        `eligibility=includes&eventId=${a.id}&secondEventId=${b.id}`,
        ["02 Both", "03 Legacy"],
      ],
      [
        `eligibility=exact&eventId=${b.id.toUpperCase()}&secondEventId=${a.id}`,
        ["02 Both"],
      ],
      [
        `eligibility=exact&eventId=${b.id}&secondEventId=${c.id}`,
        ["06 Alternate pair"],
      ],
      [`eligibility=includes&eventId=${d.id}`, ["07 Retained inactive"]],
      [`eligibility=exact&eventId=${randomUUID()}`, []],
      ["eligibility=none", ["08 No sessions"]],
      ["eligibility=legacy", ["03 Legacy"]],
      [
        "opening=opened&status=ACTIVE",
        ["01 Ceremony only", "02 Both", "03 Legacy", "07 Retained inactive"],
      ],
      [
        "opening=unopened&rsvpStatus=PENDING",
        ["06 Alternate pair", "08 No sessions", "09 Outside first page"],
      ],
      [
        `eligibility=exact&eventId=${a.id}&opening=unopened&rsvpStatus=PENDING&status=ACTIVE&search=Last%20Traveler`,
        ["09 Outside first page"],
      ],
    ] as const) {
      const response = await list(query);
      expect(response.statusCode, query).toBe(200);
      const body = response.json();
      expect(body.page.totalItems, query).toBe(names.length);
      expect(
        body.items.map((row: { displayName: string }) => row.displayName),
        query,
      ).toEqual(names);
      expect(body.overview).toEqual(expectedOverview);
      expect(body.publicInvitationOrigin).toBe(PUBLIC_ORIGIN);
      expect(response.body).not.toContain(outside.publicCredential);
      const keys = responseKeys(body);
      for (const key of [
        "publicUrl",
        "publicTokenHash",
        "qrPayload",
        "fullName",
        "sessionToken",
      ]) {
        expect(keys).not.toContain(key);
      }
    }
    const pageQueries = [1, 2, 3, 4].map((page) =>
      list(`page=${page}&pageSize=2&eligibility=includes&eventId=${a.id}`),
    );
    const pages = (await Promise.all(pageQueries)).map((response) => {
      expect(response.statusCode).toBe(200);
      return response.json();
    });
    expect(pages.map((p) => p.page.totalItems)).toEqual([5, 5, 5, 5]);
    expect(
      pages.map((p) =>
        p.items.map((row: { displayName: string }) => row.displayName),
      ),
    ).toEqual([
      ["01 Ceremony only", "02 Both"],
      ["03 Legacy", "04 Archived"],
      ["09 Outside first page"],
      [],
    ]);
    expect(
      pages[1].items[0].eligibleEvents.map((event: { id: string }) => event.id),
    ).toEqual([a.id, b.id, c.id]);
    expect(pages[1].items[0].eligibleEvents).toHaveLength(3);
    expect(pages[2].items[0]).toMatchObject({
      id: outside.invitation.id,
      rsvpStatus: "PENDING",
    });

    // All equal sort keys still need a deterministic order across pages.
    await prisma.invitation.updateMany({
      data: { createdAt: new Date("2027-01-02T10:00:00Z") },
    });
    const sortedIds = (
      await prisma.invitation.findMany({
        orderBy: { id: "asc" },
        select: { id: true },
      })
    ).map(({ id }) => id);
    const pagedIds: string[] = [];
    for (const page of [1, 2, 3]) {
      const response = await app.inject({
        url: `/api/admin/invitations?page=${page}&pageSize=3`,
        headers: { cookie: session.cookie },
      });
      expect(response.statusCode).toBe(200);
      pagedIds.push(
        ...response.json().items.map(({ id }: { id: string }) => id),
      );
    }
    expect(pagedIds).toEqual(sortedIds);

    for (const bad of [
      "opening=never",
      "opening=",
      "opening=opened&opening=unopened",
      "eligibility=",
      "eligibility=includes",
      "eligibility=none&eventId=",
      "eligibility=exact&eventId=invalid",
      "eligibility=exact&secondEventId=" + b.id,
      `eligibility=exact&eventId=${a.id}&secondEventId=${a.id.toUpperCase()}`,
      `eligibility=exact&eventId=${a.id}&eventId=${b.id}`,
      `eventId=${a.id}`,
      "unsupported=x",
      "page=1&page=2",
    ]) {
      const response = await list(bad);
      expect(response.statusCode, bad).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns a zero overview and an empty page for an empty wedding", async () => {
    const session = await createOwnerAndSession();
    const response = await app.inject({
      url: "/api/admin/invitations?eligibility=legacy",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [],
      publicInvitationOrigin: PUBLIC_ORIGIN,
      page: { number: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
      overview: {
        households: 0,
        namedGuests: 0,
        opened: 0,
        unopened: 0,
        events: [],
        rsvp: { accepted: 0, declined: 0, pending: 0 },
      },
    });
  });

  it("returns invitation detail with relations and excludes sensitive fields", async () => {
    const session = await createOwnerAndSession();
    const event = await createEvent({
      displayOrder: 1,
      name: "Ceremony",
      slug: "ceremony-detail",
    });
    const { invitation } = await createInvitation(credentialService, {
      displayName: "Detail Household",
      eventIds: [event.id],
      greetingName: "Detail",
      invitees: [
        { fullName: "Adult Guest", label: "Parent" },
        { category: InviteeCategory.CHILD, fullName: "Child Guest" },
      ],
      notes: "admin-only notes",
      publicTokenVersion: 3,
      rsvp: RSVPStatus.ACCEPTED,
      status: InvitationStatus.ARCHIVED,
    });
    const rsvp = await prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: invitation.id },
    });
    const invitees = await prisma.invitee.findMany({
      where: { invitationId: invitation.id },
      orderBy: { displayOrder: "asc" },
    });
    const invitee = invitees[0]!;
    await prisma.rSVPAttendee.create({
      data: {
        attendeeType: RSVPAttendeeType.NAMED_INVITEE,
        displayName: "Adult Guest",
        inviteeId: invitee.id,
        quantity: 1,
        rsvpId: rsvp.id,
      },
    });
    await prisma.rSVPEventSelection.create({
      data: {
        attending: true,
        eventId: event.id,
        expectedAttendeeCount: 1,
        rsvpId: rsvp.id,
      },
    });
    await prisma.guestMessage.createMany({
      data: [
        {
          invitationId: invitation.id,
          message: "Visible message",
        },
        {
          invitationId: invitation.id,
          isHidden: true,
          message: "Hidden message",
        },
      ],
    });
    await prisma.checkinPass.create({
      data: {
        credentialVersion: 2,
        invitationId: invitation.id,
        revokedAt: new Date("2026-09-30T03:00:00.000Z"),
        revocationReason: "RSVP_DECLINED",
        rsvpId: rsvp.id,
        status: CheckinPassStatus.REVOKED,
        tokenHash: `checkin-token-${randomUUID()}`,
      },
    });
    const noRsvpInvitation = await createInvitation(credentialService, {
      displayName: "No RSVP Detail Household",
    });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${invitation.id}`,
      });
    const noRsvpResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${noRsvpInvitation.invitation.id}`,
      });
    const missing = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${randomUUID()}`,
      });
    const body = response.json();
    const rsvpForbiddenFields = [
      "id",
      "attendeeQuantityTotal",
      "attendees",
      "eventSelections",
      "dietaryNotes",
      "guestNote",
      "adminOverrideReason",
      "submittedByAdminUserId",
      "adminUser",
      "qrPayload",
      "tokenHash",
    ];
    const keys = responseKeys(body);

    expect(response.statusCode).toBe(200);
    expect(body.invitation).toMatchObject({
      archivedAt: expect.any(String),
      displayName: "Detail Household",
      messages: { hidden: 1, total: 2 },
      notes: "admin-only notes",
      publicTokenVersion: 3,
      status: "ARCHIVED",
    });
    expect(
      body.invitation.invitees.map(
        (item: { fullName: string }) => item.fullName,
      ),
    ).toEqual(["Adult Guest", "Child Guest"]);
    expect(body.invitation.invitees).toEqual([
      expect.objectContaining({
        category: "ADULT",
        displayOrder: 0,
        fullName: "Adult Guest",
        id: invitees[0]!.id,
        label: "Parent",
        updatedAt: invitees[0]!.updatedAt.toISOString(),
      }),
      expect.objectContaining({
        category: "CHILD",
        displayOrder: 1,
        fullName: "Child Guest",
        id: invitees[1]!.id,
        label: null,
        updatedAt: invitees[1]!.updatedAt.toISOString(),
      }),
    ]);
    expect(body.invitation.eligibility[0].event).toMatchObject({
      id: event.id,
      name: "Ceremony",
      slug: "ceremony-detail",
    });
    expect(body.invitation.rsvp).toEqual({
      attendingEvents: [
        {
          id: event.id,
          name: "Ceremony",
          slug: "ceremony-detail",
          displayOrder: 1,
          isActive: true,
        },
      ],
      lastUpdatedAt: expect.any(String),
      status: "ACCEPTED",
      submittedAt: "2026-09-30T02:00:00.000Z",
      version: 1,
    });
    expect(Object.keys(body.invitation.rsvp).sort()).toEqual([
      "attendingEvents",
      "lastUpdatedAt",
      "status",
      "submittedAt",
      "version",
    ]);
    for (const field of rsvpForbiddenFields) {
      expect(body.invitation.rsvp).not.toHaveProperty(field);
    }
    expect(body.invitation.checkinPasses[0]).toMatchObject({
      credentialVersion: 2,
      revocationReason: "RSVP_DECLINED",
      status: "REVOKED",
    });
    expect(noRsvpResponse.statusCode).toBe(200);
    expect(noRsvpResponse.json().invitation.rsvp).toBeNull();
    expect(keys).not.toContain("publicTokenHash");
    expect(keys).not.toContain("publicUrl");
    expect(keys).not.toContain("qrPayload");
    expect(keys).not.toContain("tokenHash");
    expect(keys).not.toContain("sessionTokenHash");
    expect(keys).not.toContain("csrfTokenHash");
    expect(keys).not.toContain("passwordHash");
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("derives the public URL without mutating open aggregates or trusting request host", async () => {
    const session = await createOwnerAndSession();
    const active = await createInvitation(credentialService, {
      displayName: "Active URL",
      openCount: 4,
    });
    const archived = await createInvitation(credentialService, {
      displayName: "Archived URL",
      status: InvitationStatus.ARCHIVED,
    });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          cookie: session.cookie,
          host: "evil.example.test",
          origin: "http://evil.example.test",
        },
        method: "GET",
        url: `/api/admin/invitations/${active.invitation.id}/public-url`,
      });
    const afterPublicUrl = await prisma.invitation.findUniqueOrThrow({
      where: { id: active.invitation.id },
    });
    const publicLookup = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${active.publicCredential}`,
      });
    const archivedResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${archived.invitation.id}/public-url`,
      });
    const missingResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${randomUUID()}/public-url`,
      });
    await prisma.invitation.update({
      data: { publicTokenHash: `mismatch-${randomUUID()}` },
      where: { id: active.invitation.id },
    });
    const mismatch = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: { cookie: session.cookie },
        method: "GET",
        url: `/api/admin/invitations/${active.invitation.id}/public-url`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      publicTokenVersion: 1,
      publicUrl: `${PUBLIC_ORIGIN}/i/${active.publicCredential}`,
    });
    expect(afterPublicUrl.openCount).toBe(4);
    expect(afterPublicUrl.firstOpenedAt).toBeNull();
    expect(afterPublicUrl.lastOpenedAt?.toISOString()).toBe(
      "2026-09-30T01:00:00.000Z",
    );
    expect(publicLookup.statusCode).toBe(200);
    expect(archivedResponse.statusCode).toBe(409);
    expect(archivedResponse.json()).toMatchObject({
      error: { code: "CONFLICT" },
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(mismatch.statusCode).toBe(500);
    expect(mismatch.body).not.toContain(active.publicCredential);
    expect(mismatch.body).not.toContain("mismatch-");
  });

  it("validates PUBLIC_INVITATION_BASE_URL configuration", async () => {
    const session = await createOwnerAndSession();
    const { invitation } = await createInvitation(credentialService, {
      displayName: "Config URL",
    });
    const previousNodeEnv = process.env.NODE_ENV;
    const previousBaseUrl = process.env.PUBLIC_INVITATION_BASE_URL;

    async function requestWithConfig(nodeEnv: string, baseUrl: string) {
      process.env.NODE_ENV = nodeEnv;
      process.env.PUBLIC_INVITATION_BASE_URL = baseUrl;
      const cookieName =
        nodeEnv === "production" ? "__Host-admin_session" : "admin_session";

      return app
        .getHttpAdapter()
        .getInstance()
        .inject({
          headers: { cookie: `${cookieName}=${session.sessionToken}` },
          method: "GET",
          url: `/api/admin/invitations/${invitation.id}/public-url`,
        });
    }

    const local = await requestWithConfig("test", "http://localhost:3000/");
    const isolatedLocal = await requestWithConfig(
      "test",
      "http://localhost:3100",
    );
    const lanHttp = await requestWithConfig("test", "http://192.168.1.2:3100");
    const spoofLocal = await requestWithConfig(
      "test",
      "http://localhost.evil.test:3100",
    );
    const https = await requestWithConfig(
      "production",
      "https://invite.example.com",
    );
    const prodHttp = await requestWithConfig(
      "production",
      "http://localhost:3000",
    );
    const path = await requestWithConfig(
      "test",
      "https://invite.example.com/path",
    );
    const query = await requestWithConfig(
      "test",
      "https://invite.example.com?x=1",
    );
    const fragment = await requestWithConfig(
      "test",
      "https://invite.example.com#x",
    );
    const credentials = await requestWithConfig(
      "test",
      "https://user:pass@invite.example.com",
    );
    const wildcard = await requestWithConfig("test", "https://*.example.com");

    process.env.NODE_ENV = previousNodeEnv;
    process.env.PUBLIC_INVITATION_BASE_URL = previousBaseUrl;

    expect(local.statusCode).toBe(200);
    expect(isolatedLocal.statusCode).toBe(200);
    expect(
      isolatedLocal.json().publicUrl.startsWith("http://localhost:3100/i/"),
    ).toBe(true);
    expect(lanHttp.statusCode).toBe(500);
    expect(spoofLocal.statusCode).toBe(500);
    expect(local.json().publicUrl).toMatch(/^http:\/\/localhost:3000\/i\//);
    expect(https.statusCode).toBe(200);

    for (const response of [
      prodHttp,
      path,
      query,
      fragment,
      credentials,
      wildcard,
    ]) {
      expect(response.statusCode).toBe(500);
    }
  });
});
