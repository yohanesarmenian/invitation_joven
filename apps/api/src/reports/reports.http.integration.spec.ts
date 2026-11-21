import "reflect-metadata";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    ownerCsrf: string,
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
        ownerCsrf = session.csrfToken;
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
      await prisma.cateringSnapshot.deleteMany({
        where: { capturedById: ownerId },
      });
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

  const write = (
    method: "POST" | "PUT",
    url: string,
    payload: object,
    cookie = ownerCookie,
    csrf = ownerCsrf,
  ) =>
    app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        payload,
        headers: {
          cookie,
          origin: "http://localhost:3001",
          "x-csrf-token": csrf,
        },
      });

  it("updates the OWNER wedding policy without overwriting explicit invitation deadlines", async () => {
    const url = "/api/admin/rsvp-policy";
    const baseline = await prisma.weddingRsvpPolicy.findUniqueOrThrow({
      where: { id: 1 },
    });
    const id = ids[0]!;
    const override = new Date("2034-01-01T12:34:56.123Z");
    await prisma.invitation.update({
      where: { id },
      data: { rsvpDeadlineAt: override },
    });
    const input = {
      expectedVersion: baseline.version,
      initialDeadlineAt: "2034-01-01T17:30:00.000Z",
      finalEditDeadlineAt: "2034-01-02T17:30:00.000Z",
      allowLateEdits: true,
    };
    try {
      expect((await write("PUT", url, input, staffCookie)).statusCode).toBe(
        403,
      );
      expect(
        (await write("PUT", url, input, ownerCookie, "wrong")).statusCode,
      ).toBe(403);
      expect(
        (
          await write("PUT", url, {
            ...input,
            finalEditDeadlineAt: override.toISOString(),
          })
        ).statusCode,
      ).toBe(400);
      const saved = await write("PUT", url, input);
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        version: baseline.version + 1,
        activeExceptionCount: 1,
        activeExceptions: [{ id, rsvpDeadlineAt: override.toISOString() }],
      });
      expect((await get(url)).json()).toEqual(saved.json());
      expect(
        await prisma.weddingRsvpPolicy.findUniqueOrThrow({ where: { id: 1 } }),
      ).toMatchObject({
        initialDeadlineAt: new Date(input.initialDeadlineAt),
        finalEditDeadlineAt: new Date(input.finalEditDeadlineAt),
        allowLateEdits: true,
      });
      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id } }))
          .rsvpDeadlineAt,
      ).toEqual(override);
      expect((await write("PUT", url, input)).statusCode).toBe(409);
    } finally {
      const { id, ...data } = baseline;
      await prisma.weddingRsvpPolicy.update({ where: { id }, data });
    }
  });

  it("freezes independently reproducible versions and reconciles deltas under the same session and archive scope", async () => {
    const url = "/api/admin/reports/catering";
    const latest = (await get(url + "/snapshots")).json()[0]?.version ?? 0;
    const first = {
      operationId: randomUUID(),
      eventId: null,
      includeArchived: false,
      expectedVersion: latest,
    };
    expect(
      (await write("POST", url + "/snapshots", first, staffCookie)).statusCode,
    ).toBe(403);
    expect(
      (await write("POST", url + "/snapshots", first, ownerCookie, "wrong"))
        .statusCode,
    ).toBe(403);
    const [a, replay] = await Promise.all([
      write("POST", url + "/snapshots", first),
      write("POST", url + "/snapshots", first),
    ]);
    expect(a.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(a.json()).toEqual(replay.json());
    const stored = await prisma.cateringSnapshot.findUniqueOrThrow({
      where: { operationId: first.operationId },
    });
    expect(stored).toMatchObject({
      version: latest + 1,
      capturedById: ownerId,
      schemaVersion: 1,
    });
    expect(stored.payload).toMatchObject({
      scope: { includeArchived: false, eventId: null },
      rows: expect.arrayContaining([
        expect.objectContaining({
          invitationId: ids[0],
          eventId,
          rsvpExpected: 3,
        }),
        expect.objectContaining({ invitationId: ids[3], status: "PENDING" }),
        expect.objectContaining({ invitationId: ids[4], status: "DECLINED" }),
      ]),
    });
    const frozenUrl = url + "/snapshots/" + stored.version;
    expect(
      (await get(frozenUrl + "/export?kind=summary", staffCookie)).statusCode,
    ).toBe(403);
    expect((await get(frozenUrl + "/export?kind=summary", "")).statusCode).toBe(
      401,
    );
    const summary1 = await get(frozenUrl + "/export?kind=summary");
    const detail1 = await get(frozenUrl + "/export?kind=households");
    expect(summary1.statusCode).toBe(200);
    expect(detail1.statusCode).toBe(200);
    expect(detail1.body).not.toContain(ids[2]!);
    await prisma.rSVPEventSelection.updateMany({
      where: { rsvp: { invitationId: ids[1]! }, eventId },
      data: { expectedAttendeeCount: 2 },
    });
    try {
      const comparison = (await get(frozenUrl)).json();
      const frozen = comparison.frozen.events.find(
        (event: { id: string }) => event.id === eventId,
      );
      const live = comparison.live.events.find(
        (event: { id: string }) => event.id === eventId,
      );
      expect(frozen).toMatchObject({
        expected: 7,
        actual: 2,
        partialHouseholds: 1,
      });
      expect(live.expected).toBe(5);
      expect(comparison.changes).toEqual([
        expect.objectContaining({
          invitationId: ids[1],
          netChange: -2,
          evidence: ["CHANGE_CAUSE_NOT_VERIFIABLE"],
        }),
      ]);
      const changesCsv = await get(frozenUrl + "/export?kind=changes");
      expect(changesCsv.statusCode).toBe(200);
      expect(changesCsv.body).toContain("EXPECTED_DECREASED");
      const second = {
        operationId: randomUUID(),
        eventId,
        includeArchived: true,
        expectedVersion: stored.version,
      };
      const attempts = [second, { ...second, operationId: randomUUID() }];
      const requests = await Promise.all(
        attempts.map((attempt) => write("POST", url + "/snapshots", attempt)),
      );
      expect(requests.map((result) => result.statusCode).sort()).toEqual([
        201, 409,
      ]);
      const nextVersion = stored.version + 1;
      const loserIndex = requests.findIndex(
        (result) => result.statusCode === 409,
      );
      const winnerIndex = 1 - loserIndex;
      const rejection = {
        error: {
          code: "CATERING_SNAPSHOT_VERSION_CONFLICT",
          details: { latestVersion: nextVersion },
        },
      };
      expect(requests[loserIndex]!.json()).toMatchObject(rejection);
      const recoveredLoser = await write(
        "POST",
        url + "/snapshots",
        attempts[loserIndex]!,
      );
      expect(recoveredLoser.statusCode).toBe(409);
      expect(recoveredLoser.json()).toMatchObject(rejection);
      const recoveredWinner = await write(
        "POST",
        url + "/snapshots",
        attempts[winnerIndex]!,
      );
      expect(recoveredWinner.statusCode).toBe(201);
      expect(recoveredWinner.json()).toEqual(requests[winnerIndex]!.json());
      expect(
        await prisma.cateringSnapshot.findMany({
          where: {
            operationId: { in: attempts.map((attempt) => attempt.operationId) },
          },
          select: { operationId: true, version: true },
        }),
      ).toEqual([
        {
          operationId: attempts[winnerIndex]!.operationId,
          version: nextVersion,
        },
      ]);
      const version2 = (
        await get(url + "/snapshots/" + (stored.version + 1))
      ).json();
      expect(version2.snapshot.includeArchived).toBe(true);
      expect(version2.frozen.events).toEqual([
        expect.objectContaining({ id: eventId, expected: 10, actual: 7 }),
      ]);
      expect((await get(frozenUrl + "/export?kind=summary")).body).toBe(
        summary1.body,
      );
      expect((await get(frozenUrl + "/export?kind=households")).body).toBe(
        detail1.body,
      );
      expect(
        await prisma.cateringSnapshot.findUniqueOrThrow({
          where: { version: stored.version },
        }),
      ).toEqual(stored);
    } finally {
      await prisma.rSVPEventSelection.updateMany({
        where: { rsvp: { invitationId: ids[1]! }, eventId },
        data: { expectedAttendeeCount: 4 },
      });
    }
  });

  it("captures a consistent view while an RSVP commits and leaves no version on a failed insert", async () => {
    const path = "/api/admin/reports/catering/snapshots";
    const expectedVersion = (await get(path)).json()[0]?.version ?? 0;
    const operationId = randomUUID();
    const options = {
      eventId,
      includeArchived: false,
      expectedVersion,
      operationId,
    };
    let signalLocked!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locker = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE events IN ACCESS EXCLUSIVE MODE`;
      signalLocked();
      await released;
    });
    await Promise.race([locker, locked]);
    const freezing = write("POST", path, options);
    try {
      await vi.waitFor(async () => {
        const [waiting] = await prisma.$queryRaw<{ waiting: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_locks WHERE relation='events'::regclass AND NOT granted) AS waiting
        `;
        expect(waiting?.waiting).toBe(true);
      });
      await prisma.rSVPEventSelection.updateMany({
        where: { rsvp: { invitationId: ids[1]! }, eventId },
        data: { expectedAttendeeCount: 2 },
      });
    } finally {
      release();
      await locker;
    }
    try {
      expect((await freezing).statusCode).toBe(201);
      const read = (await get(path + "/" + (expectedVersion + 1))).json();
      expect(read.frozen.events[0].expected).toBe(7);
      expect(read.live.events[0].expected).toBe(5);
    } finally {
      await prisma.rSVPEventSelection.updateMany({
        where: { rsvp: { invitationId: ids[1]! }, eventId },
        data: { expectedAttendeeCount: 4 },
      });
    }

    // Synthetic fault on this disposable database, at the snapshot write boundary.
    const rejectedId = "416ededf-c47b-41a8-abfe-a09e42d08cbc";
    await prisma.$executeRaw`ALTER TABLE catering_snapshots ADD CONSTRAINT qa_reject_capture
      CHECK (operation_id <> '416ededf-c47b-41a8-abfe-a09e42d08cbc'::uuid)`;
    try {
      const failed = await write("POST", path, {
        ...options,
        expectedVersion: expectedVersion + 1,
        operationId: rejectedId,
      });
      expect(failed.statusCode).toBe(500);
      expect(
        await prisma.cateringSnapshot.findUnique({
          where: { operationId: rejectedId },
        }),
      ).toBeNull();
      expect((await get(path)).json()[0].version).toBe(expectedVersion + 1);
    } finally {
      await prisma.$executeRaw`ALTER TABLE catering_snapshots DROP CONSTRAINT qa_reject_capture`;
    }
  });

  it("protects stored snapshots from runtime update, deletion and truncation", async () => {
    const path = "/api/admin/reports/catering/snapshots";
    const expectedVersion = (await get(path)).json()[0]?.version ?? 0;
    const operationId = randomUUID();
    expect(
      (
        await write("POST", path, {
          eventId,
          includeArchived: false,
          expectedVersion,
          operationId,
        })
      ).statusCode,
    ).toBe(201);
    const role = "catering_qa_" + randomUUID().replaceAll("-", "");
    await prisma.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN`);
    try {
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await prisma.$executeRawUnsafe(
        `GRANT SELECT,UPDATE,DELETE,TRUNCATE ON catering_snapshots TO ${role}`,
      );
      for (const mutation of [
        "UPDATE catering_snapshots SET schema_version = schema_version",
        "DELETE FROM catering_snapshots",
        "TRUNCATE catering_snapshots",
      ]) {
        await expect(
          prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            await tx.$executeRawUnsafe(mutation);
            throw new Error("Unexpected runtime mutation would have succeeded");
          }),
        ).rejects.toThrow(/Catering snapshots are immutable/);
      }
      expect(
        await prisma.cateringSnapshot.count({ where: { operationId } }),
      ).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(`DROP OWNED BY ${role}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
  });
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
