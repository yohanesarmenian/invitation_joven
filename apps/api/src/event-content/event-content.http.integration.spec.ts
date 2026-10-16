import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import sharp from "sharp";
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
import type {
  AdminEventContentDto,
  EventVenueBodyDto,
} from "./event-content.dto.js";

const origin = "http://localhost:3001";
const content = (title = "Guest parking"): EventVenueBodyDto => ({
  parking: {
    title,
    instructions: ["Use the designated guest entrance."],
    mapAssetId: null,
    mapAlt: "",
    pdfAssetId: null,
    googleMapsUrl: null,
  },
  rundown: {
    title: "Reception schedule",
    items: [
      {
        startsAt: "2027-01-09T11:30:00+07:00",
        title: "Guest arrival",
        description: "",
      },
    ],
  },
});
describe("OWNER event content, assets and publication with PostgreSQL", () => {
  let app: NestFastifyApplication,
    prisma: PrismaService,
    credentials: CredentialService,
    eventId: string;
  let owner: Record<string, string>, staff: Record<string, string>;
  const users: string[] = [],
    events: string[] = [],
    invitations: string[] = [];
  const path = () => `/api/admin/event-content/${eventId}`;
  async function createEvent() {
    const event = await prisma.event.create({
      data: {
        slug: `venue-${randomUUID()}`,
        name: "Synthetic reception",
        displayOrder: randomInt(1, 1_000_000_000),
      },
    });
    events.push(event.id);
    return event.id;
  }
  async function invite(
    eventIds: string[],
    status: "ACTIVE" | "ARCHIVED" = "ACTIVE",
  ) {
    const id = randomUUID(),
      credential = credentials.deriveCredential({
        namespace: "invitation",
        stableId: id,
        version: 1,
      });
    await prisma.invitation.create({
      data: {
        id,
        displayName: "Synthetic venue household",
        status,
        publicTokenHash: credentials.hashCredential(credential),
        invitationEvents: { create: eventIds.map((eventId) => ({ eventId })) },
      },
    });
    invitations.push(id);
    return { id, credential, path: `/api/public/invitations/${credential}` };
  }
  async function upload(
    buffer: Buffer,
    filename: string,
    mimetype: string,
    version: number,
    headers = owner,
  ) {
    const boundary = "venue-boundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: "POST",
      url: `${path()}/assets?expectedVersion=${version}`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
  }
  beforeAll(async () => {
    process.env.CREDENTIAL_SECRET ??=
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    process.env.ADMIN_ORIGIN = origin;
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
    const hash = await new AdminPasswordService().hashPassword(
      "synthetic venue password",
    );
    for (const role of ["OWNER", "CHECKIN_STAFF"] as const) {
      const user = await prisma.adminUser.create({
        data: {
          email: `venue-${randomUUID()}@example.com`,
          role,
          passwordHash: hash,
        },
      });
      users.push(user.id);
      const tokens = new AdminSessionTokenService().generateSessionTokens();
      await prisma.adminSession.create({
        data: {
          adminUserId: user.id,
          sessionTokenHash: tokens.sessionTokenHash,
          csrfTokenHash: tokens.csrfTokenHash,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      const headers = {
        cookie: `admin_session=${tokens.sessionToken}`,
        origin,
        "x-csrf-token": tokens.csrfToken,
      };
      if (role === "OWNER") owner = headers;
      else staff = headers;
    }
  });
  beforeEach(async () => {
    eventId = await createEvent();
  });
  afterAll(async () => {
    if (prisma) {
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
  it("persists a draft, publishes a separate snapshot, edits without changing it, and hides without opening invitations", async () => {
    const guest = await invite([eventId]);
    expect(
      (await app.inject({ method: "GET", url: path(), headers: owner })).json()
        .version,
    ).toBe(0);
    let response = await app.inject({
      method: "PUT",
      url: path(),
      headers: owner,
      payload: { expectedVersion: 0, content: content() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().version).toBe(1);
    expect(
      (await prisma.eventContent.findUniqueOrThrow({ where: { eventId } }))
        .draft,
    ).toEqual(content());
    expect(
      (
        await app.inject({ method: "GET", url: `${guest.path}/venue-content` })
      ).json(),
    ).toEqual({ items: [] });
    response = await app.inject({
      method: "POST",
      url: `${path()}/publish`,
      headers: owner,
      payload: { expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().version).toBe(2);
    response = await app.inject({
      method: "PUT",
      url: path(),
      headers: owner,
      payload: { expectedVersion: 2, content: content("Edited draft") },
    });
    expect(response.json().draft.parking.title).toBe("Edited draft");
    expect(response.json().published.parking.title).toBe("Guest parking");
    expect(
      (
        await app.inject({ method: "GET", url: `${guest.path}/venue-content` })
      ).json().items[0].content.parking.title,
    ).toBe("Guest parking");
    response = await app.inject({
      method: "POST",
      url: `${path()}/hide`,
      headers: owner,
      payload: { expectedVersion: 3 },
    });
    expect(response.json().published).toBeNull();
    expect(response.json().draft.parking.title).toBe("Edited draft");
    expect(
      (
        await app.inject({ method: "GET", url: `${guest.path}/venue-content` })
      ).json(),
    ).toEqual({ items: [] });
    expect(
      (await prisma.invitation.findUniqueOrThrow({ where: { id: guest.id } }))
        .openCount,
    ).toBe(0);
  });
  it("serializes concurrent first saves: one version winner, one conflict and no overwritten draft", async () => {
    const responses = await Promise.all(
      ["A", "B"].map((title) =>
        app.inject({
          method: "PUT",
          url: path(),
          headers: owner,
          payload: { expectedVersion: 0, content: content(title) },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const saved = await prisma.eventContent.findUniqueOrThrow({
      where: { eventId },
    });
    expect(saved.version).toBe(1);
    expect(saved.draft).toEqual(
      content(
        responses.find((r) => r.statusCode === 200)!.json().draft.parking.title,
      ),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${path()}/publish`,
          headers: owner,
          payload: { expectedVersion: 0 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await prisma.eventContent.findUniqueOrThrow({ where: { eventId } }))
        .published,
    ).toBeNull();
  });
  it("normalizes an image, protects draft/other-event files, and revokes public access after hide or credential rotation", async () => {
    const image = await sharp({
      create: { width: 8, height: 4, channels: 3, background: "white" },
    })
      .jpeg()
      .withMetadata()
      .toBuffer();
    let response = await upload(image, "map.jpg", "image/jpeg", 0);
    expect(response.statusCode).toBe(200);
    const state = response.json<AdminEventContentDto>(),
      asset = state.assets[0]!;
    expect(asset.mimeType).toBe("image/png");
    const bytes = await prisma.eventContentAsset.findUniqueOrThrow({
      where: { id: asset.id },
    });
    expect((await sharp(bytes.bytes).metadata()).exif).toBeUndefined();
    const guest = await invite([eventId]),
      other = await invite([await createEvent()]);
    const assetPath = `${guest.path}/venue-assets/${asset.id}`;
    expect(
      (await app.inject({ method: "GET", url: assetPath })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${path()}/assets/${asset.id}`,
          headers: owner,
        })
      ).statusCode,
    ).toBe(200);
    const body = content();
    body.parking!.mapAssetId = asset.id;
    body.parking!.mapAlt = "Guest entrance and parking";
    await app.inject({
      method: "PUT",
      url: path(),
      headers: owner,
      payload: { expectedVersion: 1, content: body },
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${path()}/assets/${asset.id}`,
          headers: owner,
          payload: { expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(409);
    await app.inject({
      method: "POST",
      url: `${path()}/publish`,
      headers: owner,
      payload: { expectedVersion: 2 },
    });
    response = await app.inject({ method: "GET", url: assetPath });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${other.path}/venue-assets/${asset.id}`,
        })
      ).statusCode,
    ).toBe(404);
    const previousEvent = eventId;
    eventId = await createEvent();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path(),
          headers: owner,
          payload: { expectedVersion: 0, content: body },
        })
      ).statusCode,
    ).toBe(400);
    eventId = previousEvent;
    await prisma.invitation.update({
      where: { id: guest.id },
      data: {
        publicTokenHash: credentials.hashCredential(
          credentials.deriveCredential({
            namespace: "invitation",
            stableId: guest.id,
            version: 2,
          }),
        ),
      },
    });
    expect(
      (await app.inject({ method: "GET", url: assetPath })).statusCode,
    ).toBe(404);
    const current = credentials.deriveCredential({
      namespace: "invitation",
      stableId: guest.id,
      version: 2,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/public/invitations/${current}/venue-assets/${asset.id}`,
        })
      ).statusCode,
    ).toBe(200);
    await app.inject({
      method: "POST",
      url: `${path()}/hide`,
      headers: owner,
      payload: { expectedVersion: 3 },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/public/invitations/${current}/venue-assets/${asset.id}`,
        })
      ).statusCode,
    ).toBe(404);
    await app.inject({
      method: "PUT",
      url: path(),
      headers: owner,
      payload: {
        expectedVersion: 4,
        content: { parking: null, rundown: null },
      },
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `${path()}/assets/${asset.id}`,
          headers: owner,
          payload: { expectedVersion: 5 },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await prisma.eventContentAsset.count({ where: { id: asset.id } }),
    ).toBe(0);
  });
  it("rejects unsupported/corrupt/mismatched/oversized uploads and serves PDFs as attachments", async () => {
    expect(
      (await upload(Buffer.from("<svg/>"), "map.svg", "image/svg+xml", 0))
        .statusCode,
    ).toBe(400);
    expect(
      (await upload(Buffer.from("not a png"), "map.png", "image/png", 0))
        .statusCode,
    ).toBe(400);
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    expect((await upload(image, "map.jpg", "image/jpeg", 0)).statusCode).toBe(
      400,
    );
    expect(
      (
        await upload(
          Buffer.alloc(5 * 1024 * 1024 + 1),
          "guide.pdf",
          "application/pdf",
          0,
        )
      ).statusCode,
    ).toBe(400);
    const response = await upload(
      Buffer.from("%PDF-1.4\n%%EOF\n"),
      "guide.pdf",
      "application/pdf",
      0,
    );
    expect(response.statusCode).toBe(200);
    const binary = await app.inject({
      method: "GET",
      url: `${path()}/assets/${response.json().assets[0].id}`,
      headers: owner,
    });
    expect(binary.headers["content-disposition"]).toMatch(/^attachment/);
    expect(binary.headers["content-security-policy"]).toContain("sandbox");
  });
  it("denies staff/unauth/invalid CSRF/origin and leaves data unchanged", async () => {
    expect((await app.inject({ method: "GET", url: path() })).statusCode).toBe(
      401,
    );
    expect(
      (await app.inject({ method: "GET", url: path(), headers: staff }))
        .statusCode,
    ).toBe(403);
    for (const headers of [
      { ...owner, "x-csrf-token": "wrong" },
      { ...owner, origin: "https://foreign.example" },
    ]) {
      expect(
        (
          await app.inject({
            method: "PUT",
            url: path(),
            headers,
            payload: { expectedVersion: 0, content: content() },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(await prisma.eventContent.count({ where: { eventId } })).toBe(0);
  });
  it("keeps archived/unknown credentials generic and excludes inactive or ineligible event publications", async () => {
    const guest = await invite([eventId]),
      archived = await invite([eventId], "ARCHIVED"),
      noEvent = await invite([]);
    await app.inject({
      method: "PUT",
      url: path(),
      headers: owner,
      payload: { expectedVersion: 0, content: content() },
    });
    await app.inject({
      method: "POST",
      url: `${path()}/publish`,
      headers: owner,
      payload: { expectedVersion: 1 },
    });
    expect(
      (
        await app.inject({ method: "GET", url: `${guest.path}/venue-content` })
      ).json().items,
    ).toHaveLength(1);
    for (const url of [
      `${archived.path}/venue-content`,
      `/api/public/invitations/${"Z".repeat(43)}/venue-content`,
      `${guest.path}/venue-assets/not-a-uuid`,
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("INVITATION_NOT_AVAILABLE");
      expect(response.body).not.toContain(guest.credential);
      expect(response.body).not.toContain(archived.credential);
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${noEvent.path}/venue-content`,
        })
      ).json(),
    ).toEqual({ items: [] });
    await prisma.event.update({
      where: { id: eventId },
      data: { isActive: false },
    });
    expect(
      (
        await app.inject({ method: "GET", url: `${guest.path}/venue-content` })
      ).json(),
    ).toEqual({ items: [] });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${path()}/publish`,
          headers: owner,
          payload: { expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await prisma.eventContent.findUniqueOrThrow({ where: { eventId } }))
        .version,
    ).toBe(2);
  });
  it("allows unfinished drafts but rejects empty, invalid or reversed published rundown", async () => {
    const body = content();
    body.rundown!.items[0]!.startsAt = "";
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path(),
          headers: owner,
          payload: { expectedVersion: 0, content: body },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${path()}/publish`,
          headers: owner,
          payload: { expectedVersion: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await prisma.eventContent.findUniqueOrThrow({ where: { eventId } }))
        .version,
    ).toBe(1);
    body.rundown!.items[0]!.startsAt = "2027-02-30T11:00:00+07:00";
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path(),
          headers: owner,
          payload: { expectedVersion: 1, content: body },
        })
      ).statusCode,
    ).toBe(400);
  });
});
