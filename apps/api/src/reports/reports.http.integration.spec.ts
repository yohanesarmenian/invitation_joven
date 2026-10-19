import "reflect-metadata";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { configureApp } from "../app.setup.js";
import { PrismaService } from "../database/prisma.service.js";
import { AdminPasswordService } from "../auth/password.service.js";
import { AdminSessionTokenService } from "../auth/session-token.service.js";
describe("OWNER reporting with PostgreSQL", () => {
  let app: NestFastifyApplication,
    prisma: PrismaService,
    ownerId: string,
    staffId: string,
    ownerCookie: string,
    staffCookie: string,
    eventId: string,
    otherEventId: string;
  const ids: string[] = [];
  async function household(
    name: string,
    status: "ACTIVE" | "ARCHIVED",
    rsvpStatus: "ACCEPTED" | "DECLINED" | null,
    expected: number,
    actual: number | null,
  ) {
    const id = randomUUID();
    ids.push(id);
    await prisma.invitation.create({
      data: {
        id,
        displayName: name,
        status,
        publicTokenHash: createHash("sha256").update(id).digest("hex"),
        invitationEvents: { create: { eventId } },
      },
    });
    if (rsvpStatus) {
      const r = await prisma.rSVP.create({
        data: {
          invitationId: id,
          status: rsvpStatus,
          dietaryNotes: '  =HYPERLINK("synthetic")',
          ...(rsvpStatus === "ACCEPTED"
            ? {
                eventSelections: {
                  create: {
                    eventId,
                    attending: true,
                    expectedAttendeeCount: expected,
                  },
                },
                attendees: {
                  create: [
                    { attendeeType: "PLUS_ONE", quantity: 1 },
                    { attendeeType: "ADDITIONAL_CHILD", quantity: 2 },
                  ],
                },
              }
            : {}),
        },
      });
      if (name === "Accepted A")
        await prisma.rSVPEventSelection.create({
          data: {
            rsvpId: r.id,
            eventId: otherEventId,
            attending: true,
            expectedAttendeeCount: 1,
          },
        });
    }
    if (actual !== null)
      await prisma.checkinRecord.create({
        data: {
          invitationId: id,
          eventId,
          confirmedByAdminUserId: ownerId,
          method: "MANUAL",
          attendeeCount: actual,
        },
      });
  }
  beforeAll(async () => {
    process.env.CREDENTIAL_SECRET ??=
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    process.env.ADMIN_ORIGIN = "http://localhost:3001";
    process.env.PUBLIC_INVITATION_BASE_URL = "http://localhost:3000";
    process.env.NODE_ENV = "test";
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    const hash = await new AdminPasswordService().hashPassword(
        "synthetic reporting password",
      ),
      tokens = new AdminSessionTokenService();
    for (const role of ["OWNER", "CHECKIN_STAFF"] as const) {
      const user = await prisma.adminUser.create({
          data: {
            email: `reports-${role}-${randomUUID()}@example.com`,
            role,
            passwordHash: hash,
          },
        }),
        session = tokens.generateSessionTokens();
      await prisma.adminSession.create({
        data: {
          adminUserId: user.id,
          sessionTokenHash: session.sessionTokenHash,
          csrfTokenHash: session.csrfTokenHash,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      if (role === "OWNER") {
        ownerId = user.id;
        ownerCookie = `admin_session=${session.sessionToken}`;
      } else {
        staffId = user.id;
        staffCookie = `admin_session=${session.sessionToken}`;
      }
    }
    const base = randomInt(1, 900_000_000);
    eventId = (
      await prisma.event.create({
        data: {
          slug: `reports-${randomUUID()}`,
          name: "Report Event",
          displayOrder: base,
        },
      })
    ).id;
    otherEventId = (
      await prisma.event.create({
        data: {
          slug: `reports-${randomUUID()}`,
          name: "Other report event",
          displayOrder: base + 1,
          isActive: false,
        },
      })
    ).id;
    await household("Accepted A", "ACTIVE", "ACCEPTED", 3, 2);
    await household("Accepted B", "ACTIVE", "ACCEPTED", 4, null);
    await household("Archived A", "ARCHIVED", "ACCEPTED", 5, 5);
    await household("No response", "ACTIVE", null, 0, null);
    await household("Declined", "ACTIVE", "DECLINED", 0, null);
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.checkinRecord.deleteMany({
        where: { invitationId: { in: ids } },
      });
      await prisma.rSVP.deleteMany({ where: { invitationId: { in: ids } } });
      await prisma.invitationEvent.deleteMany({
        where: { invitationId: { in: ids } },
      });
      await prisma.invitation.deleteMany({ where: { id: { in: ids } } });
      await prisma.event.deleteMany({
        where: { id: { in: [eventId, otherEventId] } },
      });
      await prisma.adminSession.deleteMany({
        where: { adminUserId: { in: [ownerId, staffId] } },
      });
      await prisma.adminUser.deleteMany({
        where: { id: { in: [ownerId, staffId] } },
      });
    }
    await app?.close();
  });
  const get = (path: string, cookie = ownerCookie) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: path, headers: { cookie } });
  it("aggregates selections and actual records independently; archived inclusion is explicit", async () => {
    const result = await get(`/api/admin/reports/summary?eventId=${eventId}`);
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.json().events).toEqual([
      expect.objectContaining({
        expectedAttendeeCount: 7,
        expectedHouseholds: 2,
        actualAttendeeCount: 2,
        checkedInHouseholds: 1,
        notArrivedHouseholds: 1,
      }),
    ]);
    const history = await get(
      `/api/admin/reports/summary?eventId=${eventId}&archived=include`,
    );
    expect(history.json().events[0]).toMatchObject({
      expectedAttendeeCount: 12,
      actualAttendeeCount: 7,
      checkedInHouseholds: 2,
      notArrivedHouseholds: 1,
    });
    const inactive = await get(
      `/api/admin/reports/summary?eventId=${otherEventId}`,
    );
    expect(inactive.json().events[0]).toMatchObject({
      isActive: false,
      expectedAttendeeCount: 1,
      actualAttendeeCount: 0,
      notArrivedHouseholds: 1,
    });
  });
  it("projects pending, dietary and missing households with stable pagination and no bearer fields", async () => {
    const list = await get(
      `/api/admin/reports/households?eventId=${eventId}&pageSize=2`,
    );
    expect(list.statusCode).toBe(200);
    expect(list.json().page).toMatchObject({
      number: 1,
      pageSize: 2,
      totalItems: 4,
      totalPages: 2,
    });
    expect(list.json().items[0]).toMatchObject({
      displayName: "Accepted A",
      rsvpHouseholdSize: 3,
      eventId: null,
      actualAttendeeCount: null,
    });
    const missing = await get(
      `/api/admin/reports/households?kind=NOT_ARRIVED&eventId=${eventId}`,
    );
    expect(missing.json().items).toEqual([
      expect.objectContaining({
        displayName: "Accepted B",
        expectedAttendeeCount: 4,
        actualAttendeeCount: null,
      }),
    ]);
    const page2 = await get(
      `/api/admin/reports/households?eventId=${eventId}&pageSize=2&page=2`,
    );
    expect(page2.json().items).toContainEqual(
      expect.objectContaining({
        displayName: "No response",
        rsvpStatus: "PENDING",
        rsvpHouseholdSize: 0,
      }),
    );
    for (const key of [
      "qrPayload",
      "publicTokenHash",
      "tokenHash",
      "checkinPass",
      "guestNote",
    ])
      expect(list.body.includes(key)).toBe(false);
  });
  it("exports the same filtered rows with formula safety and blocks staff/anonymous/invalid queries", async () => {
    const result = await get(
      `/api/admin/reports/export?kind=CHECKIN&eventId=${eventId}`,
    );
    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toContain("text/csv");
    expect(result.body).toContain("Accepted A");
    expect(result.body).not.toContain("Archived A");
    expect(result.body).toContain("'  =HYPERLINK");
    expect(result.body).toContain("checkedInAtUtc");
    for (const path of ["summary", "households", "export"]) {
      expect(
        (await get(`/api/admin/reports/${path}`, staffCookie)).statusCode,
      ).toBe(403);
      expect((await get(`/api/admin/reports/${path}`, "")).statusCode).toBe(
        401,
      );
    }
    for (const query of [
      "archived=true",
      "eventId=bad",
      "kind=OTHER",
      "page=0",
      "extra=value",
    ])
      expect(
        (await get(`/api/admin/reports/households?${query}`)).statusCode,
      ).toBe(400);
  });
});
