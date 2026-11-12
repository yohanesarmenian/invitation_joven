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

const prisma = new PrismaClient({ adapter: new PrismaPg(getDatabaseUrl()) });
const origin = "http://localhost:3001";
let app: NestFastifyApplication, credentials: CredentialService;
const households: string[] = [],
  events: string[] = [],
  users: string[] = [];
async function actor(role: AdminRole) {
  const user = await prisma.adminUser.create({
    data: {
      email: `reception-${randomUUID()}@example.test`,
      passwordHash: "synthetic-unusable-hash",
      role,
    },
  });
  users.push(user.id);
  const token = new AdminSessionTokenService().generateSessionTokens();
  await prisma.adminSession.create({
    data: {
      adminUserId: user.id,
      sessionTokenHash: token.sessionTokenHash,
      csrfTokenHash: token.csrfTokenHash,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  return {
    user,
    headers: {
      cookie: `admin_session=${token.sessionToken}`,
      origin,
      "x-csrf-token": token.csrfToken,
    },
  };
}
async function fixture() {
  const id = randomUUID(),
    credential = credentials.deriveCredential({
      namespace: "invitation",
      stableId: id,
      version: 1,
    });
  const invitation = await prisma.invitation.create({
    data: {
      id,
      displayName: `Reception synthetic ${id}`,
      greetingName: "Synthetic Family",
      publicTokenHash: credentials.hashCredential(credential),
      allowPlusOne: true,
      maxAdditionalChildren: 1,
      rsvpDeadlineAt: new Date("2020-01-01"),
    },
  });
  households.push(id);
  const event = await prisma.event.create({
    data: {
      slug: `reception-${id}`,
      name: "Synthetic reception",
      displayOrder: Math.floor(Math.random() * 1e9),
    },
  });
  events.push(event.id);
  const people = await Promise.all(
    [0, 1].map((displayOrder) =>
      prisma.invitee.create({
        data: {
          invitationId: id,
          fullName: `Synthetic person ${displayOrder}`,
          displayOrder,
          category: "ADULT",
        },
      }),
    ),
  );
  await prisma.invitationEvent.create({
    data: { invitationId: id, eventId: event.id },
  });
  const manager = await actor("GUEST_MANAGER"),
    owner = await actor("OWNER"),
    staff = await actor("CHECKIN_STAFF");
  return { invitation, event, people, manager, owner, staff, credential };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function command(f: Fixture, count = 2) {
  return {
    operationId: randomUUID(),
    invitationId: f.invitation.id,
    eventId: f.event.id,
    attendeeCount: count,
    method: "MANUAL",
    verificationMethod: "PHYSICAL_INVITATION",
    onSite: {
      status: "ACCEPTED",
      expectedVersion: null as number | null,
      attendees: [
        ...f.people.map((person) => ({
          type: "NAMED_INVITEE",
          inviteeId: person.id,
          quantity: 1,
        })),
        { type: "PLUS_ONE", quantity: 1 },
        { type: "ADDITIONAL_CHILD", quantity: 1 },
      ],
      eventSelections: [
        { eventId: f.event.id, attending: true, expectedAttendeeCount: 4 },
      ],
      reason: "Physical card and expected family verified",
    },
  };
}
const post = (f: Fixture, body: unknown, headers = f.manager.headers) =>
  app.inject({
    method: "POST",
    url: "/api/admin/reception/arrivals",
    headers: { ...headers, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
const detail = (f: Fixture) =>
  app.inject({
    method: "GET",
    url: `/api/admin/reception/households/${f.invitation.id}?eventId=${f.event.id}`,
    headers: f.manager.headers,
  });
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
  credentials = app.get(CredentialService);
});
afterEach(async () => {
  await prisma.checkinRecord.deleteMany({
    where: { invitationId: { in: households } },
  });
  await prisma.checkinPass.deleteMany({
    where: { invitationId: { in: households } },
  });
  await prisma.rSVP.deleteMany({ where: { invitationId: { in: households } } });
  await prisma.invitationEvent.deleteMany({
    where: { invitationId: { in: households } },
  });
  await prisma.invitee.deleteMany({
    where: { invitationId: { in: households } },
  });
  await prisma.invitation.deleteMany({ where: { id: { in: households } } });
  await prisma.event.deleteMany({ where: { id: { in: events } } });
  await prisma.adminSession.deleteMany({
    where: { adminUserId: { in: users } },
  });
  await prisma.adminUser.deleteMany({ where: { id: { in: users } } });
  households.length = events.length = users.length = 0;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("real PostgreSQL reception workflow", () => {
  it("paginates larger same-name lists with unique references and indexed name search", async () => {
    const f = await fixture();
    const rows = Array.from({ length: 28 }, (_, index) => {
      const id = randomUUID();
      households.push(id);
      return {
        id,
        displayName: `Paged reception family ${String(index).padStart(2, "0")}`,
        publicTokenHash: credentials.hashCredential(
          credentials.deriveCredential({
            namespace: "invitation",
            stableId: id,
            version: 1,
          }),
        ),
      };
    });
    await prisma.invitation.createMany({ data: rows });
    const pages = await Promise.all(
      [1, 2].map((page) =>
        app.inject({
          method: "GET",
          url: `/api/admin/reception/search?query=Paged%20reception&eventId=${f.event.id}&page=${page}`,
          headers: f.manager.headers,
        }),
      ),
    );
    expect(pages[0]!.json().items).toHaveLength(25);
    expect(pages[0]!.json().hasMore).toBe(true);
    expect(pages[1]!.json().items).toHaveLength(3);
    expect(pages[1]!.json().hasMore).toBe(false);
    const codes = [...pages[0]!.json().items, ...pages[1]!.json().items].map(
      (item: { referenceCode: string }) => item.referenceCode,
    );
    expect(new Set(codes).size).toBe(28);
    const indexes = await prisma.$queryRaw<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE indexname IN ('invitation_reception_search','invitee_reception_search','invitations_reference_code_key')`;
    expect(indexes).toHaveLength(3);
  });
  it("provisions Guest Managers through OWNER staff management and revokes disabled/reset sessions without creating OWNER", async () => {
    const f = await fixture();
    const provision = await app.inject({
      method: "POST",
      url: "/api/admin/staff",
      headers: f.owner.headers,
      payload: {
        email: `new-manager-${randomUUID()}@example.test`,
        role: "GUEST_MANAGER",
      },
    });
    expect(provision.statusCode).toBe(201);
    const id = provision.json().staff.id as string;
    users.push(id);
    expect(provision.json().staff).toMatchObject({
      role: "GUEST_MANAGER",
      mustChangePassword: true,
    });
    const listing = await app.inject({
      method: "GET",
      url: "/api/admin/staff",
      headers: f.owner.headers,
    });
    expect(
      listing.json().items.map((item: { id: string }) => item.id),
    ).toContain(id);
    expect(listing.body).not.toContain("temporaryPassword");
    const session = new AdminSessionTokenService().generateSessionTokens();
    await prisma.adminSession.create({
      data: {
        adminUserId: id,
        sessionTokenHash: session.sessionTokenHash,
        csrfTokenHash: session.csrfTokenHash,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const reset = await app.inject({
      method: "POST",
      url: `/api/admin/staff/${id}/reset-password`,
      headers: f.owner.headers,
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().staff.role).toBe("GUEST_MANAGER");
    expect(
      (
        await prisma.adminSession.findFirstOrThrow({
          where: { adminUserId: id },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/admin/staff/${f.manager.user.id}`,
          headers: f.owner.headers,
          payload: { status: "DISABLED" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await detail(f)).statusCode).toBe(401);
    const escalation = await app.inject({
      method: "POST",
      url: "/api/admin/staff",
      headers: f.owner.headers,
      payload: { email: "synthetic-escalation@example.test", role: "OWNER" },
    });
    expect(escalation.statusCode).toBe(400);
  });

  it("makes arrival history immutable for an online role, including cascade deletion", async () => {
    const f = await fixture();
    expect((await post(f, command(f))).statusCode).toBe(201);
    const role = `p4c_${randomUUID().replaceAll("-", "")}`,
      password = randomUUID(),
      url = new URL(getDatabaseUrl());
    url.username = role;
    url.password = password;
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    const appRole = new PrismaClient({ adapter: new PrismaPg(url.toString()) });
    try {
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await prisma.$executeRawUnsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA public TO ${role}`,
      );
      await expect(
        appRole.checkinArrival.updateMany({
          where: { invitationId: f.invitation.id },
          data: { attendeeCount: 1 },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        appRole.checkinArrival.deleteMany({
          where: { invitationId: f.invitation.id },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        appRole.$executeRawUnsafe("TRUNCATE checkin_arrivals"),
      ).rejects.toThrow(/append-only/);
      await expect(
        appRole.checkinRecord.deleteMany({
          where: { invitationId: f.invitation.id },
        }),
      ).rejects.toThrow(/append-only/);
      expect(
        await appRole.checkinArrival.count({
          where: { invitationId: f.invitation.id },
        }),
      ).toBe(1);
    } finally {
      await appRole.$disconnect();
      await prisma.$executeRawUnsafe(`DROP OWNED BY ${role}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${role}`);
    }
  });
  it("limits Guest Manager routes, retains OWNER/legacy staff, and enforces origin/CSRF/password/session state", async () => {
    const f = await fixture();
    for (const url of [
      `/api/admin/reception/households/${f.invitation.id}?eventId=${f.event.id}`,
      `/api/admin/reception/statistics?eventId=${f.event.id}`,
    ]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: "GET", url, headers: f.staff.headers }))
          .statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ method: "GET", url, headers: f.manager.headers }))
          .statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: "GET", url, headers: f.owner.headers }))
          .statusCode,
      ).toBe(200);
    }
    for (const url of [
      "/api/admin/dashboard",
      "/api/admin/staff",
      "/api/admin/events",
      "/api/admin/rsvps",
      "/api/admin/event-management",
    ]) {
      expect(
        (await app.inject({ method: "GET", url, headers: f.manager.headers }))
          .statusCode,
      ).toBe(403);
    }
    expect(
      (
        await post(f, command(f), {
          ...f.manager.headers,
          origin: "https://untrusted.example",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(f, command(f), {
          ...f.manager.headers,
          "x-csrf-token": "wrong",
        })
      ).statusCode,
    ).toBe(403);
    await prisma.adminUser.update({
      where: { id: f.manager.user.id },
      data: { mustChangePassword: true },
    });
    expect((await detail(f)).statusCode).toBe(403);
    await prisma.adminUser.update({
      where: { id: f.manager.user.id },
      data: { mustChangePassword: false, status: "DISABLED" },
    });
    expect((await detail(f)).statusCode).toBe(401);
    expect(
      await prisma.checkinArrival.count({
        where: { invitationId: f.invitation.id },
      }),
    ).toBe(0);
  });

  it("looks up Pending/Declined/Accepted by indexed names and case-insensitive stable reference without exposing credentials", async () => {
    const f = await fixture();
    for (const query of [
      f.invitation.referenceCode.toLowerCase(),
      "Synthetic person",
      "Synthetic Family",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/admin/reception/search?eventId=${f.event.id}&query=${encodeURIComponent(query)}&page=1`,
        headers: f.manager.headers,
      });
      expect(response.statusCode).toBe(200);
      expect(
        response.json().items.map((item: { id: string }) => item.id),
      ).toContain(f.invitation.id);
      expect(response.body).not.toMatch(/publicTokenHash|qrPayload|tokenHash/);
      expect(response.body.includes(f.credential)).toBe(false);
    }
    await prisma.rSVP.create({
      data: { invitationId: f.invitation.id, status: "DECLINED" },
    });
    const before = (await detail(f)).json();
    expect(before.household.rsvpStatus).toBe("DECLINED");
    await prisma.invitation.update({
      where: { id: f.invitation.id },
      data: { status: "ARCHIVED" },
    });
    expect((await detail(f)).json().household.eligible).toBe(false);
    expect((await post(f, command(f))).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/admin/reception/search?query=x&eventId=${f.event.id}`,
          headers: f.manager.headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/admin/reception/search?query=person&eventId=${f.event.id}&page=0`,
          headers: f.manager.headers,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("atomically establishes explicit on-site expectation then records 2 + 1 + 1, retaining one pass and accurate aggregates", async () => {
    const f = await fixture(),
      initial = command(f);
    const first = await post(f, initial);
    expect(first.statusCode).toBe(201);
    expect(first.json().arrival).toMatchObject({
      attendeeCount: 2,
      totalAfter: 2,
      expectedAttendeeCount: 4,
      actorRole: "GUEST_MANAGER",
      verificationMethod: "PHYSICAL_INVITATION",
    });
    const history = await prisma.rsvpChangeEvent.findMany({
      where: { invitationId: f.invitation.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: "ON_SITE_RSVP",
      actorRole: "GUEST_MANAGER",
      actorAdminUserId: f.manager.user.id,
      verificationMethod: "PHYSICAL_INVITATION",
      updatedValues: { status: "ACCEPTED" },
    });
    const publicState = await app.inject({
      method: "GET",
      url: `/api/public/invitations/${f.credential}/rsvp`,
    });
    expect(publicState.json()).toMatchObject({
      canEdit: false,
      editBlockedReason: "CHECKED_IN",
    });
    expect(publicState.body).not.toContain("ON_SITE_RSVP");
    const qrPayload = publicState.json().checkinPass.qrPayload;
    const next = {
      operationId: randomUUID(),
      invitationId: f.invitation.id,
      eventId: f.event.id,
      attendeeCount: 1,
      method: "QR",
      verificationMethod: "QR",
      qrPayload,
    };
    expect((await post(f, next)).json().arrival.totalAfter).toBe(3);
    expect(
      (await post(f, { ...next, operationId: randomUUID() })).json().arrival
        .totalAfter,
    ).toBe(4);
    expect(
      (await post(f, { ...next, operationId: randomUUID() })).statusCode,
    ).toBe(422);
    const persisted = await prisma.checkinRecord.findMany({
      where: { invitationId: f.invitation.id },
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.attendeeCount).toBe(4);
    expect(
      await prisma.checkinArrival.count({
        where: { invitationId: f.invitation.id },
      }),
    ).toBe(3);
    expect(
      await prisma.checkinPass.count({
        where: { invitationId: f.invitation.id, status: "ACTIVE" },
      }),
    ).toBe(1);
    expect((await detail(f)).json().household).toMatchObject({
      referenceCode: f.invitation.referenceCode,
      allowedCount: 4,
      expectedCount: 4,
      arrivedCount: 4,
      remainingCount: 0,
    });
    const stats = await app.inject({
      method: "GET",
      url: `/api/admin/reception/statistics?eventId=${f.event.id}`,
      headers: f.manager.headers,
    });
    expect(stats.json()).toMatchObject({
      registeredHouseholds: 1,
      acceptedHouseholds: 1,
      arrivedGuests: 4,
      expectedGuests: 4,
      partialHouseholds: 0,
      completedHouseholds: 1,
      qrGuests: 2,
      manualGuests: 2,
      onSiteConfirmations: 1,
    });
    const ownerReport = await app.inject({
      method: "GET",
      url: `/api/admin/reports/summary?eventId=${f.event.id}`,
      headers: f.owner.headers,
    });
    expect(ownerReport.statusCode).toBe(200);
    expect(ownerReport.json().events[0]).toMatchObject({
      expectedAttendeeCount: 4,
      actualAttendeeCount: 4,
      checkedInHouseholds: 1,
    });
    const ledger = JSON.stringify(
      await prisma.checkinArrival.findMany({
        where: { invitationId: f.invitation.id },
      }),
    );
    expect(ledger.includes(qrPayload)).toBe(false);
    expect(ledger.includes(f.credential)).toBe(false);
  });

  it("returns the same receipt for a retry, refuses operation reuse with changed payload/operator, and supports authoritative recovery", async () => {
    const f = await fixture(),
      body = command(f);
    const first = await post(f, body);
    expect(first.statusCode).toBe(201);
    expect((await post(f, body)).json()).toEqual(first.json());
    const status = await app.inject({
      method: "GET",
      url: `/api/admin/reception/operations/${body.operationId}?eventId=${f.event.id}&invitationId=${f.invitation.id}`,
      headers: f.manager.headers,
    });
    expect(status.json()).toEqual(first.json());
    expect((await post(f, { ...body, attendeeCount: 1 })).statusCode).toBe(409);
    expect((await post(f, body, f.owner.headers)).statusCode).toBe(409);
    expect(
      await prisma.checkinArrival.count({
        where: { invitationId: f.invitation.id },
      }),
    ).toBe(1);
  });

  it("serializes competing staff operations without exceeding expected capacity or duplicating a retried operation", async () => {
    const f = await fixture();
    expect((await post(f, command(f, 2))).statusCode).toBe(201);
    const base = {
      invitationId: f.invitation.id,
      eventId: f.event.id,
      attendeeCount: 2,
      method: "MANUAL",
      verificationMethod: "HOUSEHOLD_DETAILS",
    };
    const responses = await Promise.all([
      post(f, { ...base, operationId: randomUUID() }),
      post(f, { ...base, operationId: randomUUID() }, f.owner.headers),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    expect((await detail(f)).json().household.arrivedCount).toBe(4);
    const other = await fixture(),
      same = command(other, 2);
    const duplicates = await Promise.all([
      post(other, same),
      post(other, same),
    ]);
    expect(duplicates.map((r) => r.statusCode)).toEqual([201, 201]);
    expect(duplicates[0]!.json()).toEqual(duplicates[1]!.json());
  });

  it("serializes public RSVP and onsite arrival through the same household lock", async () => {
    const f = await fixture();
    await prisma.invitation.update({
      where: { id: f.invitation.id },
      data: { rsvpDeadlineAt: new Date(Date.now() + 86400000) },
    });
    const body = command(f);
    const results = await Promise.all([
      post(f, body),
      app.inject({
        method: "PUT",
        url: `/api/public/invitations/${f.credential}/rsvp`,
        payload: { ...body.onSite, reason: undefined },
      }),
    ]);
    expect(
      results.filter(
        (result) => result.statusCode === 200 || result.statusCode === 201,
      ),
    ).toHaveLength(1);
    expect(
      await prisma.rsvpChangeEvent.count({
        where: { invitationId: f.invitation.id },
      }),
    ).toBe(1);
    const record = await prisma.checkinRecord.findFirst({
      where: { invitationId: f.invitation.id },
    });
    expect(record?.attendeeCount ?? 0).toBe(
      results[0]!.statusCode === 201 ? 2 : 0,
    );
  });

  it("requires a declined override reason, rejects stale onsite versions and rolls back an over-capacity first arrival", async () => {
    const f = await fixture();
    await prisma.rSVP.create({
      data: { invitationId: f.invitation.id, status: "DECLINED", version: 3 },
    });
    const body = command(f);
    body.onSite.expectedVersion = 3;
    expect(
      (await post(f, { ...body, onSite: { ...body.onSite, reason: "" } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await post(f, {
          ...body,
          onSite: { ...body.onSite, expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(409);
    expect((await post(f, { ...body, attendeeCount: 5 })).statusCode).toBe(422);
    expect(
      await prisma.rsvpChangeEvent.count({
        where: { invitationId: f.invitation.id },
      }),
    ).toBe(0);
    expect(
      await prisma.checkinPass.count({
        where: { invitationId: f.invitation.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.rSVP.findUniqueOrThrow({
          where: { invitationId: f.invitation.id },
        })
      ).status,
    ).toBe("DECLINED");
    expect((await post(f, body)).statusCode).toBe(201);
    const locked = await post(f, {
      ...body,
      operationId: randomUUID(),
      onSite: { ...body.onSite, expectedVersion: 4 },
    });
    expect(locked.statusCode).toBe(409);
  });

  it("rejects invitation credentials/reference codes as QR and rejects a revoked real pass", async () => {
    const f = await fixture();
    expect((await post(f, command(f))).statusCode).toBe(201);
    for (const qrPayload of [f.credential, f.invitation.referenceCode])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/admin/reception/validate",
            headers: f.manager.headers,
            payload: { eventId: f.event.id, qrPayload },
          })
        ).statusCode,
      ).toBeGreaterThanOrEqual(400);
    const pass = await prisma.checkinPass.findFirstOrThrow({
      where: { invitationId: f.invitation.id },
    });
    const qrPayload = credentials.deriveCredential({
      namespace: "check-in",
      stableId: pass.id,
      version: pass.credentialVersion,
    });
    await prisma.checkinPass.update({
      where: { id: pass.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/admin/reception/validate",
      headers: f.manager.headers,
      payload: { eventId: f.event.id, qrPayload },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe("QR_REVOKED");
  });

  it("rolls back onsite RSVP, audit, pass and aggregate when arrival insertion fails", async () => {
    const f = await fixture(),
      name = `p4c_fail_${randomUUID().replaceAll("-", "")}`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.invitation_id='${f.invitation.id}'::uuid THEN RAISE EXCEPTION 'Synthetic arrival insertion failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON checkin_arrivals FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      expect((await post(f, command(f))).statusCode).toBe(500);
      expect(
        await prisma.rSVP.count({ where: { invitationId: f.invitation.id } }),
      ).toBe(0);
      expect(
        await prisma.rsvpChangeEvent.count({
          where: { invitationId: f.invitation.id },
        }),
      ).toBe(0);
      expect(
        await prisma.checkinRecord.count({
          where: { invitationId: f.invitation.id },
        }),
      ).toBe(0);
      expect(
        await prisma.checkinPass.count({
          where: { invitationId: f.invitation.id },
        }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER ${name} ON checkin_arrivals`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }
  });
});
