import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { configureApp } from "../app.setup.js";
import { AdminSessionTokenService } from "../auth/session-token.service.js";
import { PrismaClient, type AdminRole } from "../generated/prisma/client.js";
import { getDatabaseUrl } from "../database/database-url.js";
import { CredentialService } from "../security/credential.service.js";
const db = new PrismaClient({ adapter: new PrismaPg(getDatabaseUrl()) });
const origin = "http://localhost:3001";
let app: NestFastifyApplication;
const users: string[] = [],
  events: string[] = [],
  ids: string[] = [];
async function actor(role: AdminRole = "GUEST_MANAGER") {
  const user = await db.adminUser.create({
    data: {
      email: `walkin-${randomUUID()}@example.test`,
      passwordHash: "synthetic-unusable-hash",
      role,
    },
  });
  users.push(user.id);
  const token = new AdminSessionTokenService().generateSessionTokens();
  await db.adminSession.create({
    data: {
      adminUserId: user.id,
      sessionTokenHash: token.sessionTokenHash,
      csrfTokenHash: token.csrfTokenHash,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    id: user.id,
    headers: {
      cookie: `admin_session=${token.sessionToken}`,
      origin,
      "x-csrf-token": token.csrfToken,
    },
  };
}
async function fixture() {
  const event = await db.event.create({
    data: {
      slug: `walkin-${randomUUID()}`,
      name: "Synthetic walkin reception",
      displayOrder: Math.floor(Math.random() * 1e9),
    },
  });
  events.push(event.id);
  return {
    event,
    manager: await actor(),
    command: {
      operationId: randomUUID(),
      eventId: event.id,
      leadName: `Walkin Family ${randomUUID()}`,
      arrivingCount: 2,
      expectedCount: 3,
      affiliation: "FRIEND",
      verificationMethod: "VERBAL_IDENTIFICATION",
      reason: "Unlisted household verified with family",
      lookupConfirmed: true,
      reviewedMatchIds: [] as string[],
      duplicateOverrideReason: null as string | null,
    },
  };
}
type Actor = Awaited<ReturnType<typeof actor>>;
async function post(path: string, body: unknown, a: Actor) {
  return app.inject({
    method: "POST",
    url: `/api/admin/reception/${path}`,
    headers: { ...a.headers, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
}
async function register(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await post("walkins", f.command, f.manager);
  expect(result.statusCode, result.body).toBe(201);
  const receipt = result.json();
  ids.push(receipt.invitationId);
  return receipt as {
    invitationId: string;
    referenceCode: string;
    operationId: string;
    eventId: string;
  };
}
async function detail(id: string, eventId: string, a: Actor) {
  const result = await app.inject({
    method: "GET",
    url: `/api/admin/reception/households/${id}?eventId=${eventId}`,
    headers: a.headers,
  });
  expect(result.statusCode).toBe(200);
  return result.json();
}
async function adjust(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  count: number,
  kind = "corrections",
  overrides: Record<string, unknown> = {},
) {
  const current = await detail(id, f.event.id, f.manager);
  return post(
    kind,
    {
      operationId: randomUUID(),
      invitationId: id,
      eventId: f.event.id,
      expectedRevision: current.household.attendanceRevision,
      count,
      method: "MANUAL",
      verificationMethod: "FAMILY_REFERENCE",
      reason: "Operator verified the corrected arrival count",
      ...overrides,
    },
    f.manager,
  );
}
beforeAll(async () => {
  process.env.ADMIN_ORIGIN = origin;
  process.env.CREDENTIAL_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
  app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false },
  );
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterEach(async () => {
  const actions = await db.receptionAction.findMany({
    where: { eventId: { in: events } },
    select: { invitationId: true },
  });
  const all = [...new Set([...ids, ...actions.map((a) => a.invitationId)])];
  await db.walkinRegistration.deleteMany({
    where: { invitationId: { in: all } },
  });
  await db.receptionAction.deleteMany({ where: { eventId: { in: events } } });
  await db.checkinRecord.deleteMany({ where: { invitationId: { in: all } } });
  await db.checkinPass.deleteMany({ where: { invitationId: { in: all } } });
  await db.rSVP.deleteMany({ where: { invitationId: { in: all } } });
  await db.invitationEvent.deleteMany({ where: { invitationId: { in: all } } });
  await db.invitee.deleteMany({ where: { invitationId: { in: all } } });
  await db.invitation.deleteMany({ where: { id: { in: all } } });
  await db.event.deleteMany({ where: { id: { in: events } } });
  await db.adminSession.deleteMany({ where: { adminUserId: { in: users } } });
  await db.adminUser.deleteMany({ where: { id: { in: users } } });
  ids.length = events.length = users.length = 0;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
describe("real PostgreSQL direct walkin and adjustment accounting", () => {
  it("registers one lead and explicit unnamed companions, atomically audited, then completes through Phase 4C", async () => {
    const f = await fixture(),
      receipt = await register(f);
    let current = await detail(receipt.invitationId, f.event.id, f.manager);
    expect(current.household).toMatchObject({
      source: "WALKIN",
      allowedCount: 3,
      expectedCount: 3,
      arrivedCount: 2,
      remainingCount: 1,
    });
    expect(current.household.invitees).toHaveLength(1);
    const credential = app.get(CredentialService).deriveCredential({
      namespace: "invitation",
      stableId: receipt.invitationId,
      version: 1,
    });
    const guest = await app.inject({
      method: "GET",
      url: `/api/public/invitations/${credential}/rsvp`,
    });
    expect(guest.statusCode).toBe(200);
    expect(guest.json()).toMatchObject({
      canEdit: false,
      editBlockedReason: "CHECKED_IN",
      rsvp: { attendeeQuantityTotal: 3 },
    });
    expect(
      guest.json().rsvp.attendees.map((a: { type: string }) => a.type),
    ).toContain("UNNAMED_COMPANION");
    const attendees = await db.rSVPAttendee.findMany({
      where: { rsvp: { invitationId: receipt.invitationId } },
    });
    expect(attendees.map((a) => [a.attendeeType, a.quantity]).sort()).toEqual([
      ["NAMED_INVITEE", 1],
      ["UNNAMED_COMPANION", 2],
    ]);
    expect(
      await db.rsvpChangeEvent.count({
        where: {
          invitationId: receipt.invitationId,
          action: "ON_SITE_RSVP",
          actorAdminUserId: f.manager.id,
        },
      }),
    ).toBe(1);
    const extra = await post(
      "arrivals",
      {
        operationId: randomUUID(),
        invitationId: receipt.invitationId,
        eventId: f.event.id,
        attendeeCount: 1,
        method: "MANUAL",
        verificationMethod: "HOUSEHOLD_DETAILS",
      },
      f.manager,
    );
    expect(extra.statusCode).toBe(201);
    current = await detail(receipt.invitationId, f.event.id, f.manager);
    expect(current.household).toMatchObject({
      arrivedCount: 3,
      remainingCount: 0,
    });
    expect(
      await db.checkinPass.count({
        where: { invitationId: receipt.invitationId, status: "ACTIVE" },
      }),
    ).toBe(1);
    for (const secret of [
      "publicCredential",
      "publicTokenHash",
      "qrPayload",
      "tokenHash",
      "payloadHash",
      "password",
    ])
      expect(JSON.stringify(current) + JSON.stringify(receipt)).not.toContain(
        secret,
      );
  });
  it("supports one unaccompanied guest without invented people or plus-one/child allowances", async () => {
    const f = await fixture();
    f.command.arrivingCount = f.command.expectedCount = 1;
    const receipt = await register(f);
    expect(
      await db.invitee.count({ where: { invitationId: receipt.invitationId } }),
    ).toBe(1);
    expect(
      await db.rSVPAttendee.count({
        where: {
          rsvp: { invitationId: receipt.invitationId },
          attendeeType: "UNNAMED_COMPANION",
        },
      }),
    ).toBe(0);
    for (const overrides of [
      { expectedCount: 26 },
      { arrivingCount: 2 },
      { expectedCount: 0 },
      { reason: "" },
      { lookupConfirmed: false },
    ])
      expect(
        (
          await post(
            "walkins",
            { ...f.command, operationId: randomUUID(), ...overrides },
            f.manager,
          )
        ).statusCode,
      ).toBe(400);
  });
  it("deduplicates identical concurrent UUIDs, recovers the original receipt, rejects changed payload and actor", async () => {
    const f = await fixture();
    const results = await Promise.all([
      post("walkins", f.command, f.manager),
      post("walkins", f.command, f.manager),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    const receipt = results[0]!.json();
    ids.push(receipt.invitationId);
    expect(
      await db.invitation.count({ where: { displayName: f.command.leadName } }),
    ).toBe(1);
    const status = await app.inject({
      method: "GET",
      url: `/api/admin/reception/actions/${f.command.operationId}`,
      headers: f.manager.headers,
    });
    expect(status.json().receipt).toEqual(receipt);
    expect(
      (await post("walkins", { ...f.command, expectedCount: 4 }, f.manager))
        .statusCode,
    ).toBe(409);
    expect((await post("walkins", f.command, await actor())).statusCode).toBe(
      409,
    );
  });
  it("requires an up-to-date duplicate review, allows legitimate same-name households only with an audited reason", async () => {
    const f = await fixture();
    f.command.leadName = "Same Name Synthetic";
    const first = await register(f);
    expect(
      (
        await post(
          "walkins",
          {
            ...f.command,
            operationId: randomUUID(),
            leadName: "  SAME   NAME Synthetic ",
          },
          f.manager,
        )
      ).statusCode,
    ).toBe(409);
    const second = {
      ...f.command,
      operationId: randomUUID(),
      reviewedMatchIds: [first.invitationId],
      duplicateOverrideReason:
        "Different unrelated household confirmed by family",
    };
    const result = await post("walkins", second, f.manager);
    expect(result.statusCode, result.body).toBe(201);
    ids.push(result.json().invitationId);
    expect(
      (
        await db.walkinRegistration.findUniqueOrThrow({
          where: { invitationId: result.json().invitationId },
        })
      ).duplicateOverrideReason,
    ).toBe(second.duplicateOverrideReason);
  });
  it("serializes same-name concurrent registrations so the second must review the newly committed match", async () => {
    const f = await fixture();
    const result = await Promise.all([
      post("walkins", f.command, f.manager),
      post(
        "walkins",
        { ...f.command, operationId: randomUUID() },
        await actor(),
      ),
    ]);
    expect(result.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    ids.push(result.find((r) => r.statusCode === 201)!.json().invitationId);
  });
  it("applies compensating corrections without rewriting original arrivals or unlocking public RSVP, including zero", async () => {
    const f = await fixture();
    f.command.arrivingCount = 3;
    const receipt = await register(f);
    const raw = await db.checkinArrival.findMany({
      where: { invitationId: receipt.invitationId },
    });
    const rsvp = await db.rSVP.findUniqueOrThrow({
      where: { invitationId: receipt.invitationId },
    });
    expect((await adjust(f, receipt.invitationId, 2)).statusCode).toBe(201);
    expect(
      await db.checkinArrival.findMany({
        where: { invitationId: receipt.invitationId },
      }),
    ).toEqual(raw);
    expect(
      (await detail(receipt.invitationId, f.event.id, f.manager)).household,
    ).toMatchObject({ arrivedCount: 2, remainingCount: 1, rsvpLocked: true });
    expect(await db.rSVP.findUniqueOrThrow({ where: { id: rsvp.id } })).toEqual(
      rsvp,
    );
    expect((await adjust(f, receipt.invitationId, 0)).statusCode).toBe(201);
    expect(
      (await detail(receipt.invitationId, f.event.id, f.manager)).household,
    ).toMatchObject({ arrivedCount: 0, rsvpLocked: true });
    expect((await adjust(f, receipt.invitationId, 4)).statusCode).toBe(422);
    expect((await adjust(f, receipt.invitationId, -1)).statusCode).toBe(400);
    expect(
      (
        await adjust(f, receipt.invitationId, 1, "corrections", {
          method: "QR",
        })
      ).statusCode,
    ).toBe(201);
  });
  it("rejects a correction that would make a method subtotal negative and rejects stale concurrent revisions", async () => {
    const f = await fixture(),
      receipt = await register(f);
    expect(
      (
        await adjust(f, receipt.invitationId, 1, "corrections", {
          method: "QR",
        })
      ).statusCode,
    ).toBe(422);
    const revision = (await detail(receipt.invitationId, f.event.id, f.manager))
      .household.attendanceRevision;
    const body = {
      operationId: randomUUID(),
      invitationId: receipt.invitationId,
      eventId: f.event.id,
      expectedRevision: revision,
      count: 1,
      method: "MANUAL",
      verificationMethod: "PHYSICAL_INVITATION",
      reason: "Corrected initial manual count",
    };
    const result = await Promise.all([
      post("corrections", body, f.manager),
      post(
        "corrections",
        { ...body, operationId: randomUUID() },
        await actor(),
      ),
    ]);
    expect(result.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await post("corrections", body, f.manager)).statusCode).toBe(
      result[0]!.statusCode === 201 ? 201 : 409,
    );
  });
  it("bounds exceptional extra guests cumulatively to five, records them atomically and preserves RSVP history", async () => {
    const f = await fixture(),
      receipt = await register(f);
    const rsvp = await db.rSVP.findUniqueOrThrow({
      where: { invitationId: receipt.invitationId },
    });
    expect(
      (await adjust(f, receipt.invitationId, 3, "exceptions")).statusCode,
    ).toBe(201);
    expect(
      (await adjust(f, receipt.invitationId, 2, "exceptions")).statusCode,
    ).toBe(201);
    expect(
      (await adjust(f, receipt.invitationId, 1, "exceptions")).statusCode,
    ).toBe(422);
    expect(
      (await detail(receipt.invitationId, f.event.id, f.manager)).household,
    ).toMatchObject({
      baseExpectedCount: 3,
      expectedCount: 8,
      arrivedCount: 7,
      exceptionAllowance: 5,
    });
    expect(await db.rSVP.findUniqueOrThrow({ where: { id: rsvp.id } })).toEqual(
      rsvp,
    );
    const stats = (
      await app.inject({
        method: "GET",
        url: `/api/admin/reception/statistics?eventId=${f.event.id}`,
        headers: f.manager.headers,
      })
    ).json();
    expect(stats).toMatchObject({
      walkinHouseholds: 1,
      walkinExpectedGuests: 8,
      walkinArrivedGuests: 7,
      exceptionalGuests: 5,
      manualGuests: 7,
      partialHouseholds: 1,
    });
    const owner = await actor("OWNER");
    const report = (
      await app.inject({
        method: "GET",
        url: `/api/admin/reports/summary?eventId=${f.event.id}`,
        headers: owner.headers,
      })
    ).json();
    expect(report.events[0]).toMatchObject({
      expectedAttendeeCount: 8,
      actualAttendeeCount: 7,
    });
  });
  for (const table of [
    "rsvps",
    "rsvp_change_events",
    "checkin_arrivals",
    "reception_actions",
  ])
    it(`rolls back the entire registration if ${table} insert fails`, async () => {
      const f = await fixture();
      await db.$executeRawUnsafe(
        `CREATE FUNCTION p4d_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER p4d_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION p4d_fail()`,
      );
      try {
        expect((await post("walkins", f.command, f.manager)).statusCode).toBe(
          500,
        );
        expect(
          await db.invitation.count({
            where: { displayName: f.command.leadName },
          }),
        ).toBe(0);
        expect(
          await db.receptionAction.count({ where: { eventId: f.event.id } }),
        ).toBe(0);
        expect(
          await db.checkinRecord.count({ where: { eventId: f.event.id } }),
        ).toBe(0);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER p4d_fail ON ${table}`);
        await db.$executeRawUnsafe("DROP FUNCTION p4d_fail()");
      }
    });
  it("keeps registration and adjustment provenance immutable to an online role", async () => {
    const f = await fixture(),
      receipt = await register(f),
      role = `p4d_${randomUUID().replaceAll("-", "")}`,
      password = randomUUID(),
      url = new URL(getDatabaseUrl());
    url.username = role;
    url.password = password;
    await db.$executeRawUnsafe(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await db.$executeRawUnsafe(
      `GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA public TO ${role}`,
    );
    const runtime = new PrismaClient({ adapter: new PrismaPg(url.toString()) });
    try {
      for (const table of ["reception_actions", "walkin_registrations"]) {
        await expect(
          runtime.$executeRawUnsafe(
            `DELETE FROM ${table} WHERE invitation_id='${receipt.invitationId}'`,
          ),
        ).rejects.toThrow(/append-only/);
        await expect(
          runtime.$executeRawUnsafe(
            `UPDATE ${table} SET invitation_id=invitation_id WHERE invitation_id='${receipt.invitationId}'`,
          ),
        ).rejects.toThrow(/append-only/);
        await expect(
          runtime.$executeRawUnsafe(`TRUNCATE ${table} CASCADE`),
        ).rejects.toThrow(/append-only/);
      }
    } finally {
      await runtime.$disconnect();
      await db.$executeRawUnsafe(`DROP OWNED BY ${role}`);
      await db.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
  });
  it("rate limits new operational actions without blocking replay of an already committed UUID", async () => {
    const f = await fixture(),
      receipt = await register(f);
    await db.receptionAction.createMany({
      data: Array.from({ length: 29 }, () => ({
        operationId: randomUUID(),
        kind: "CORRECTION",
        invitationId: receipt.invitationId,
        eventId: f.event.id,
        operatorId: f.manager.id,
        actorRole: "GUEST_MANAGER",
        payloadHash: "synthetic-rate-fixture",
        reason: "Synthetic rate limiting fixture",
        verificationMethod: "OTHER",
        delta: 1,
        receipt: { synthetic: true },
      })),
    });
    expect(
      (
        await post(
          "walkins",
          { ...f.command, operationId: randomUUID() },
          f.manager,
        )
      ).statusCode,
    ).toBe(429);
    expect((await post("walkins", f.command, f.manager)).statusCode).toBe(201);
  });
  it("retains the original correction receipt after subsequent arrivals and rejects reuse for another action", async () => {
    const f = await fixture(),
      receipt = await register(f),
      revision = (await detail(receipt.invitationId, f.event.id, f.manager))
        .household.attendanceRevision;
    const command = {
      operationId: randomUUID(),
      invitationId: receipt.invitationId,
      eventId: f.event.id,
      expectedRevision: revision,
      count: 1,
      method: "MANUAL",
      verificationMethod: "FAMILY_REFERENCE",
      reason: "Original correction verified with family",
    };
    const first = await post("corrections", command, f.manager);
    expect(first.statusCode).toBe(201);
    expect(
      (
        await post(
          "arrivals",
          {
            operationId: randomUUID(),
            invitationId: receipt.invitationId,
            eventId: f.event.id,
            attendeeCount: 1,
            method: "MANUAL",
            verificationMethod: "HOUSEHOLD_DETAILS",
          },
          f.manager,
        )
      ).statusCode,
    ).toBe(201);
    expect((await post("corrections", command, f.manager)).json()).toEqual(
      first.json(),
    );
    expect((await post("exceptions", command, f.manager)).statusCode).toBe(409);
  });
  it("rolls back exceptional allowance and arrival together if the arrival insert fails", async () => {
    const f = await fixture(),
      receipt = await register(f);
    await db.$executeRawUnsafe(
      `CREATE FUNCTION p4d_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic exception rollback'; END $$`,
    );
    await db.$executeRawUnsafe(
      "CREATE TRIGGER p4d_fail BEFORE INSERT ON checkin_arrivals FOR EACH ROW EXECUTE FUNCTION p4d_fail()",
    );
    try {
      expect(
        (await adjust(f, receipt.invitationId, 2, "exceptions")).statusCode,
      ).toBe(500);
      expect(
        (await detail(receipt.invitationId, f.event.id, f.manager)).household,
      ).toMatchObject({
        exceptionAllowance: 0,
        arrivedCount: 2,
        expectedCount: 3,
      });
    } finally {
      await db.$executeRawUnsafe("DROP TRIGGER p4d_fail ON checkin_arrivals");
      await db.$executeRawUnsafe("DROP FUNCTION p4d_fail()");
    }
  });
  it("enforces session, OWNER/GM, CSRF, Origin, forced-password and disabled-account boundaries", async () => {
    const f = await fixture();
    for (const path of ["walkins", "corrections", "exceptions"]) {
      expect(
        (await post(path, f.command, await actor("CHECKIN_STAFF"))).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/admin/reception/${path}`,
            payload: f.command,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await post(path, f.command, {
            ...f.manager,
            headers: {
              ...f.manager.headers,
              origin: "https://untrusted.example",
            },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/admin/staff",
          headers: f.manager.headers,
        })
      ).statusCode,
    ).toBe(403);
    await db.adminUser.update({
      where: { id: f.manager.id },
      data: { mustChangePassword: true },
    });
    expect((await post("walkins", f.command, f.manager)).statusCode).toBe(403);
    await db.adminUser.update({
      where: { id: f.manager.id },
      data: { mustChangePassword: false, status: "DISABLED" },
    });
    expect((await post("walkins", f.command, f.manager)).statusCode).toBe(401);
  });
});
