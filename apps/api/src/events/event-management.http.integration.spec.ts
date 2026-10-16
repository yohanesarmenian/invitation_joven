import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import { Client } from "pg";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { configureApp } from "../app.setup.js";
import { PrismaService } from "../database/prisma.service.js";
import { AdminPasswordService } from "../auth/password.service.js";
import { AdminSessionTokenService } from "../auth/session-token.service.js";
import { CredentialService } from "../security/credential.service.js";
import type { EventFieldsDto } from "./event-management.dto.js";

const origin = "http://localhost:3001";
const base = "/api/admin/event-management";
describe("OWNER event management with real PostgreSQL", () => {
  let app: NestFastifyApplication,
    prisma: PrismaService,
    credentials: CredentialService,
    eventId: string,
    ownerId: string;
  let owner: Record<string, string>, staff: Record<string, string>;
  const events: string[] = [],
    users: string[] = [],
    invitations: string[] = [];
  const fields = (): EventFieldsDto => ({
    slug: `managed-${randomUUID()}`,
    name: "Synthetic wedding event",
    description: null,
    startsAt: "2028-01-10T08:30:00+07:00",
    endsAt: "2028-01-10T10:30:00+07:00",
    venueName: "Synthetic venue",
    address: "Synthetic address",
    googleMapsUrl: "https://www.google.com/maps?q=synthetic",
    displayOrder: randomInt(1_000_000_001, 2_000_000_000),
    isActive: true,
  });
  let original: EventFieldsDto;
  const save = (patch: Partial<EventFieldsDto> = {}, version = 1) =>
    app.inject({
      method: "PUT",
      url: `${base}/${eventId}`,
      headers: owner,
      payload: { ...original, ...patch, expectedVersion: version },
    });
  async function invite(accepted = false) {
    const id = randomUUID(),
      token = credentials.deriveCredential({
        namespace: "invitation",
        stableId: id,
        version: 1,
      });
    await prisma.invitation.create({
      data: {
        id,
        displayName: "Synthetic event household",
        publicTokenHash: credentials.hashCredential(token),
        invitationEvents: { create: { eventId } },
      },
    });
    invitations.push(id);
    if (accepted)
      await prisma.rSVP.create({
        data: {
          invitationId: id,
          status: "ACCEPTED",
          version: 1,
          eventSelections: {
            create: { eventId, attending: true, expectedAttendeeCount: 1 },
          },
        },
      });
    return { id, token };
  }
  beforeAll(async () => {
    process.env.CREDENTIAL_SECRET ??=
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    process.env.ADMIN_ORIGIN = origin;
    process.env.PUBLIC_INVITATION_BASE_URL = "http://localhost:3000";
    process.env.NODE_ENV = "test";
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
    credentials = app.get(CredentialService);
    const passwordHash = await new AdminPasswordService().hashPassword(
      "synthetic event password",
    );
    for (const role of ["OWNER", "CHECKIN_STAFF"] as const) {
      const user = await prisma.adminUser.create({
        data: {
          email: `managed-${randomUUID()}@example.com`,
          role,
          passwordHash,
        },
      });
      users.push(user.id);
      const tokens = new AdminSessionTokenService().generateSessionTokens();
      await prisma.adminSession.create({
        data: {
          adminUserId: user.id,
          sessionTokenHash: tokens.sessionTokenHash,
          csrfTokenHash: tokens.csrfTokenHash,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const headers = {
        cookie: `admin_session=${tokens.sessionToken}`,
        origin,
        "x-csrf-token": tokens.csrfToken,
      };
      if (role === "OWNER") {
        owner = headers;
        ownerId = user.id;
      } else staff = headers;
    }
  });
  beforeEach(async () => {
    original = fields();
    const event = await prisma.event.create({ data: original });
    eventId = event.id;
    events.push(eventId);
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.checkinRecord.deleteMany({
        where: { eventId: { in: events } },
      });
      await prisma.rSVPEventSelection.deleteMany({
        where: { eventId: { in: events } },
      });
      await prisma.rSVP.deleteMany({
        where: { invitationId: { in: invitations } },
      });
      await prisma.invitationEvent.deleteMany({
        where: { invitationId: { in: invitations } },
      });
      await prisma.invitation.deleteMany({
        where: { id: { in: invitations } },
      });
      await prisma.event.deleteMany({ where: { id: { in: events } } });
      await prisma.adminSession.deleteMany({
        where: { adminUserId: { in: users } },
      });
      await prisma.adminUser.deleteMany({ where: { id: { in: users } } });
    }
    await app?.close();
  });
  it("requires OWNER and CSRF; preserves catalog read shape; provides no delete", async () => {
    expect((await app.inject({ method: "GET", url: base })).statusCode).toBe(
      401,
    );
    for (const method of ["GET", "POST", "PUT"] as const)
      expect(
        (
          await app.inject({
            method,
            url: method === "PUT" ? `${base}/${eventId}` : base,
            headers: staff,
            ...(method !== "GET" ? { payload: original } : {}),
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: base,
          headers: { cookie: owner.cookie, origin },
          payload: original,
        })
      ).json().error.code,
    ).toBe("CSRF_INVALID");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${base}/${eventId}`,
          headers: owner,
        })
      ).statusCode,
    ).toBe(404);
    const list = await app.inject({ method: "GET", url: base, headers: owner });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(
      list.json().items.find((r: { id: string }) => r.id === eventId).usage,
    ).toEqual({ invitations: 0, rsvps: 0, checkins: 0 });
    const catalog = (
      await app.inject({
        method: "GET",
        url: "/api/admin/events",
        headers: owner,
      })
    ).json();
    expect(
      catalog.events.find((r: { id: string }) => r.id === eventId),
    ).not.toHaveProperty("version");
  });
  it("creates and persists all fields, nullable dates, inactive state and unique constraints", async () => {
    const body = {
      ...fields(),
      startsAt: null,
      endsAt: null,
      venueName: null,
      address: null,
      googleMapsUrl: null,
      isActive: false,
    };
    const response = await app.inject({
      method: "POST",
      url: base,
      headers: owner,
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const created = response.json();
    events.push(created.id);
    expect(created).toMatchObject({ ...body, version: 1 });
    expect(
      (
        await save({
          name: "Updated venue event",
          description: "Details",
          isActive: false,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: eventId } }),
    ).toMatchObject({
      name: "Updated venue event",
      version: 2,
      isActive: false,
    });
    for (const duplicate of [
      { ...fields(), slug: original.slug },
      { ...fields(), displayOrder: original.displayOrder },
    ]) {
      const result = await app.inject({
        method: "POST",
        url: base,
        headers: owner,
        payload: duplicate,
      });
      expect(result.statusCode).toBe(409);
      expect(result.json().error.code).toBe("EVENT_UNIQUE_CONFLICT");
    }
  });
  it("rejects invalid dates, unsafe URLs, extra/missing fields and invalid integer bounds atomically", async () => {
    const before = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
    });
    for (const patch of [
      { startsAt: "2028-02-30T08:00:00+07:00" },
      { startsAt: "2028-01-10T08:00:00" },
      { endsAt: original.startsAt },
      { startsAt: null },
      { googleMapsUrl: "javascript:alert(1)" },
      { googleMapsUrl: "https://google.com.evil.test/maps" },
      { googleMapsUrl: "https://user:pass@google.com/maps" },
      { displayOrder: -1 },
      { displayOrder: 2147483648 },
      { displayOrder: 1.1 },
      { slug: "Bad slug" },
      { name: " " },
      { expectedVersion: 0 },
      { unexpected: true },
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: `${base}/${eventId}`,
        headers: owner,
        payload: { ...original, expectedVersion: 1, ...patch },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: base,
          headers: owner,
          payload: { name: "Only name" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      await prisma.event.findUniqueOrThrow({ where: { id: eventId } }),
    ).toEqual(before);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `${base}/not-a-uuid`,
          headers: owner,
          payload: { ...original, expectedVersion: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `${base}/${randomUUID()}`,
          headers: owner,
          payload: { ...original, expectedVersion: 1 },
        })
      ).statusCode,
    ).toBe(404);
  });
  it("serializes concurrent editors; stale version cannot overwrite saved fields", async () => {
    const results = await Promise.all([
      save({ name: "Editor A" }),
      save({ name: "Editor B" }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json().error.code).toBe(
      "EVENT_VERSION_CONFLICT",
    );
    const persisted = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(persisted.version).toBe(2);
    expect(persisted.name).toBe(
      results.find((r) => r.statusCode === 200)?.json().name,
    );
  });
  it("protects linked/archive history and check-in schedule while preserving RSVP/pass data", async () => {
    const guest = await invite(true);
    for (const patch of [{ isActive: false }, { slug: "changed-slug" }])
      expect((await save(patch)).json().error.code).toBe("EVENT_IN_USE");
    await prisma.checkinRecord.create({
      data: {
        eventId,
        invitationId: guest.id,
        confirmedByAdminUserId: ownerId,
        attendeeCount: 1,
        method: "MANUAL",
      },
    });
    expect(
      (await save({ startsAt: "2028-01-10T09:00:00+07:00" })).json().error.code,
    ).toBe("EVENT_SCHEDULE_LOCKED");
    const before = await prisma.rSVP.findUniqueOrThrow({
      where: { invitationId: guest.id },
      include: { eventSelections: true },
    });
    const corrected = await save({
      name: "Corrected name",
      venueName: "Corrected venue",
    });
    expect(corrected.statusCode).toBe(200);
    expect(
      await prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: guest.id },
        include: { eventSelections: true },
      }),
    ).toEqual(before);
    await prisma.invitation.update({
      where: { id: guest.id },
      data: { status: "ARCHIVED" },
    });
    expect((await save({ isActive: false }, 2)).json().error.code).toBe(
      "EVENT_IN_USE",
    );
  });
  // Observe actual PostgreSQL blocking, not elapsed-time guesses.
  async function blockedBy(pid: number) {
    for (let i = 0; i < 100; i++) {
      const rows = await prisma.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock') AS waiting`;
      if (rows[0]?.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error("Expected a real PostgreSQL lock waiter");
  }
  async function blocker() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("BEGIN");
    const pid = Number(
      (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
    return { client, pid };
  }
  it("invitation creation waits for event update and rechecks active state after lock release", async () => {
    const { client, pid } = await blocker();
    let pending;
    const name = `Synthetic blocked creation ${randomUUID()}`;
    try {
      await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [
        eventId,
      ]);
      pending = app
        .inject({
          method: "POST",
          url: "/api/admin/invitations",
          headers: owner,
          payload: {
            displayName: name,
            greetingName: null,
            allowPlusOne: false,
            maxAdditionalChildren: 0,
            rsvpDeadlineAt: null,
            notes: null,
            eventIds: [eventId],
            invitees: [{ fullName: "Synthetic guest", category: "ADULT" }],
          },
        })
        .then((r) => r);
      await blockedBy(pid);
      await client.query(
        "UPDATE events SET is_active=false, version=version+1 WHERE id=$1",
        [eventId],
      );
      await client.query("COMMIT");
      expect((await pending).statusCode).toBe(400);
      expect(
        await prisma.invitation.count({ where: { displayName: name } }),
      ).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
      await pending;
    }
  });
  it("management waits for a linked invitation commit and refuses deactivation", async () => {
    const guest = await invite();
    await prisma.invitationEvent.deleteMany({
      where: { invitationId: guest.id },
    });
    const { client, pid } = await blocker();
    let pending;
    try {
      await client.query("SELECT id FROM events WHERE id=$1 FOR SHARE", [
        eventId,
      ]);
      await client.query(
        "INSERT INTO invitation_events (id, invitation_id, event_id) VALUES ($1,$2,$3)",
        [randomUUID(), guest.id, eventId],
      );
      pending = save({ isActive: false }).then((r) => r);
      await blockedBy(pid);
      await client.query("COMMIT");
      expect((await pending).json().error.code).toBe("EVENT_IN_USE");
      expect(
        (await prisma.event.findUniqueOrThrow({ where: { id: eventId } }))
          .isActive,
      ).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
      await pending;
    }
  });
  it("staff confirmation waits for event mutation, then schedule becomes immutable", async () => {
    const guest = await invite(true),
      { client, pid } = await blocker();
    let pending;
    try {
      await client.query("SELECT id FROM events WHERE id=$1 FOR UPDATE", [
        eventId,
      ]);
      pending = app
        .inject({
          method: "POST",
          url: "/api/admin/checkin/manual-confirm",
          headers: staff,
          payload: { invitationId: guest.id, eventId, attendeeCount: 1 },
        })
        .then((r) => r);
      await blockedBy(pid);
      await client.query("COMMIT");
      expect((await pending).statusCode).toBe(201);
      expect(
        (await save({ endsAt: "2028-01-10T11:00:00+07:00" })).json().error.code,
      ).toBe("EVENT_SCHEDULE_LOCKED");
      expect(
        await prisma.checkinRecord.count({
          where: { invitationId: guest.id, eventId },
        }),
      ).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
      await pending;
    }
  });
});
