import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureApp } from "../app.setup.js";
import { getDatabaseUrl } from "../database/database-url.js";
import { PrismaClient } from "../generated/prisma/client.js";
import {
  CheckinPassStatus,
  InvitationStatus,
  InviteeCategory,
  RSVPStatus,
} from "../generated/prisma/enums.js";
import {
  DERIVED_CREDENTIAL_PATTERN,
  deriveCredentialWithSecret,
  hashDerivedCredential,
} from "../security/credential.service.js";
import type {
  CredentialLookupHash,
  DerivedCredential,
} from "../security/credential.types.js";
import { AppLogger } from "../logging/app-logger.js";
import { InvitationsModule } from "./invitations.module.js";
import { PUBLIC_RSVP_CLOCK } from "./public-rsvp.service.js";

const TEST_NOW = new Date("2026-10-01T00:00:00.000Z");
const FIXTURE_DEADLINE = new Date(
  TEST_NOW.getTime() + 30 * 24 * 60 * 60 * 1000,
);
const FIXTURE_EVENT = new Date(TEST_NOW.getTime() + 60 * 24 * 60 * 60 * 1000);
let rsvpNow = new Date(TEST_NOW);

// App-scoped DI clock; the process clock and unrelated suites are unaffected.
@Global()
@Module({
  providers: [
    { provide: PUBLIC_RSVP_CLOCK, useValue: () => new Date(rsvpNow) },
  ],
  exports: [PUBLIC_RSVP_CLOCK],
})
class PublicRsvpHttpClockModule {}

const TEST_SECRET = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const TEST_SECRET_BYTES = Buffer.from(TEST_SECRET, "base64url");
const VALID_UNKNOWN_CREDENTIAL = deriveCredentialWithSecret(
  {
    namespace: "invitation",
    stableId: "00000000-0000-0000-0000-000000000001",
    version: 1,
  },
  TEST_SECRET_BYTES,
);

process.env.CREDENTIAL_SECRET ??= TEST_SECRET;

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});

const createdInvitationIds: string[] = [];
const createdEventIds: string[] = [];
const logEntries: Array<Record<string, unknown>> = [];

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
  imports: [PublicRsvpHttpClockModule, InvitationsModule],
  providers: [
    {
      provide: AppLogger,
      useValue: testLogger,
    },
  ],
})
class PublicInvitationHttpTestModule {}

interface PublicInvitationHttpFixture {
  adultInviteeId: string;
  childInviteeId: string;
  credential: DerivedCredential;
  invitationId: string;
  linkedEventIdsByDisplayOrder: string[];
  lookupHash: CredentialLookupHash;
}

function createCredential(stableId: string, version = 1): DerivedCredential {
  return deriveCredentialWithSecret(
    {
      namespace: "invitation",
      stableId,
      version,
    },
    TEST_SECRET_BYTES,
  );
}

function uniqueDisplayOrderBase(): number {
  return randomInt(1, 1_000_000_000);
}

async function createFixture(
  options: {
    rsvpDeadlineAt?: Date | null;
    status?: InvitationStatus;
    tokenVersion?: number;
    withNullableProjection?: boolean;
    withRsvp?: boolean;
  } = {},
): Promise<PublicInvitationHttpFixture> {
  const invitationId = randomUUID();
  const tokenVersion = options.tokenVersion ?? 1;
  const credential = createCredential(invitationId, tokenVersion);
  const lookupHash = hashDerivedCredential(credential);
  const suffix = randomUUID();
  const displayOrderBase = uniqueDisplayOrderBase();

  const invitation = await prisma.invitation.create({
    data: {
      id: invitationId,
      allowPlusOne: true,
      displayName: `Slice 4 Household ${suffix}`,
      greetingName: options.withNullableProjection ? null : "Slice 4 Guests",
      maxAdditionalChildren: 2,
      publicTokenHash: lookupHash,
      publicTokenVersion: tokenVersion,
      rsvpDeadlineAt: options.withNullableProjection
        ? null
        : (options.rsvpDeadlineAt ?? FIXTURE_DEADLINE),
      status: options.status ?? InvitationStatus.ACTIVE,
    },
  });
  createdInvitationIds.push(invitation.id);

  const reception = await prisma.event.create({
    data: {
      address: options.withNullableProjection ? null : "456 Reception Avenue",
      displayOrder: displayOrderBase + 20,
      googleMapsUrl: options.withNullableProjection
        ? null
        : "https://maps.example/reception",
      name: "Reception",
      slug: `slice4-reception-${suffix}`,
      endsAt: null,
      startsAt: options.withNullableProjection ? null : FIXTURE_EVENT,
      venueName: options.withNullableProjection ? null : "Grand Ballroom",
    },
  });
  const ceremony = await prisma.event.create({
    data: {
      displayOrder: displayOrderBase + 10,
      name: "Ceremony",
      slug: `slice4-ceremony-${suffix}`,
    },
  });
  createdEventIds.push(reception.id, ceremony.id);

  await prisma.invitationEvent.createMany({
    data: [
      {
        eventId: reception.id,
        invitationId: invitation.id,
      },
      {
        eventId: ceremony.id,
        invitationId: invitation.id,
      },
    ],
  });

  const adultInvitee = await prisma.invitee.create({
    data: {
      category: InviteeCategory.ADULT,
      displayOrder: 10,
      fullName: "First Guest",
      invitationId: invitation.id,
    },
  });
  const childInvitee = await prisma.invitee.create({
    data: {
      category: InviteeCategory.CHILD,
      displayOrder: 20,
      fullName: "Second Guest",
      invitationId: invitation.id,
    },
  });

  if (options.withRsvp) {
    await prisma.rSVP.create({
      data: {
        invitationId: invitation.id,
        status: RSVPStatus.ACCEPTED,
        version: 3,
      },
    });
  }

  return {
    adultInviteeId: adultInvitee.id,
    childInviteeId: childInvitee.id,
    credential,
    invitationId: invitation.id,
    linkedEventIdsByDisplayOrder: [ceremony.id, reception.id],
    lookupHash,
  };
}

async function getInvitationState(invitationId: string) {
  return prisma.invitation.findUniqueOrThrow({
    where: {
      id: invitationId,
    },
    select: {
      firstOpenedAt: true,
      lastOpenedAt: true,
      openCount: true,
      publicTokenHash: true,
      status: true,
    },
  });
}

async function cleanupFixtures() {
  if (createdInvitationIds.length === 0 && createdEventIds.length === 0) {
    return;
  }

  await prisma.checkinRecord.deleteMany({
    where: {
      invitationId: {
        in: createdInvitationIds,
      },
    },
  });
  await prisma.checkinPass.deleteMany({
    where: {
      invitationId: {
        in: createdInvitationIds,
      },
    },
  });
  await prisma.rSVP.deleteMany({
    where: {
      invitationId: {
        in: createdInvitationIds,
      },
    },
  });
  await prisma.invitationEvent.deleteMany({
    where: {
      OR: [
        {
          invitationId: {
            in: createdInvitationIds,
          },
        },
        {
          eventId: {
            in: createdEventIds,
          },
        },
      ],
    },
  });
  await prisma.invitee.deleteMany({
    where: {
      invitationId: {
        in: createdInvitationIds,
      },
    },
  });
  await prisma.invitation.deleteMany({
    where: {
      id: {
        in: createdInvitationIds,
      },
    },
  });
  await prisma.event.deleteMany({
    where: {
      id: {
        in: createdEventIds,
      },
    },
  });

  createdInvitationIds.length = 0;
  createdEventIds.length = 0;
}

describe("GET /api/public/invitations/:publicCredential", () => {
  let app: NestFastifyApplication;

  beforeEach(() => {
    rsvpNow = new Date(TEST_NOW);
  });

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      PublicInvitationHttpTestModule,
      new FastifyAdapter(),
      { bufferLogs: true },
    );
    configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app.close();
    await prisma.$disconnect();
  });

  it("returns the public invitation response, propagates request IDs, and records exactly one open", async () => {
    const fixture = await createFixture({ withRsvp: true });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${fixture.credential}`,
        headers: {
          "x-request-id": "req-public-success",
        },
      });
    const state = await getInvitationState(fixture.invitationId);

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req-public-success");
    expect(response.json()).toMatchObject({
      invitation: {
        displayName: expect.stringContaining("Slice 4 Household"),
        greetingName: "Slice 4 Guests",
        rsvp: {
          status: RSVPStatus.ACCEPTED,
          version: 3,
        },
        rules: {
          allowPlusOne: true,
          maxAdditionalChildren: 2,
        },
      },
    });
    expect(
      response.json().invitation.events.map(({ id }: { id: string }) => id),
    ).toEqual(fixture.linkedEventIdsByDisplayOrder);
    expect(
      response
        .json()
        .invitation.invitees.map(
          ({ fullName }: { fullName: string }) => fullName,
        ),
    ).toEqual(["First Guest", "Second Guest"]);
    expect(response.body).not.toContain(fixture.lookupHash);
    expect(response.body).not.toContain("publicTokenHash");
    expect(response.body).not.toContain("publicTokenVersion");
    expect(response.body).not.toContain("openCount");

    expect(state.openCount).toBe(1);
    expect(state.firstOpenedAt).toBeInstanceOf(Date);
    expect(state.lastOpenedAt).toBeInstanceOf(Date);
  });

  it("preserves nullable public projection fields over HTTP", async () => {
    const fixture = await createFixture({ withNullableProjection: true });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${fixture.credential}`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      invitation: {
        greetingName: null,
        rsvp: null,
        rsvpDeadlineAt: null,
      },
    });
    expect(response.json().invitation.events[1]).toMatchObject({
      address: null,
      googleMapsUrl: null,
      endsAt: null,
      startsAt: null,
      venueName: null,
    });
  });

  it("treats malformed, unknown, stale, and archived credentials as the same 404 classification", async () => {
    const staleFixture = await createFixture({ tokenVersion: 2 });
    const archivedFixture = await createFixture({
      status: InvitationStatus.ARCHIVED,
    });
    const staleCredential = createCredential(staleFixture.invitationId, 1);

    const cases = [
      {
        label: "malformed",
        credential: "bad",
      },
      {
        label: "unknown",
        credential: VALID_UNKNOWN_CREDENTIAL,
      },
      {
        label: "stale",
        credential: staleCredential,
      },
      {
        label: "archived",
        credential: archivedFixture.credential,
      },
    ] as const;

    for (const [index, testCase] of cases.entries()) {
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "GET",
          url: `/api/public/invitations/${testCase.credential}`,
          headers: {
            "x-request-id": `req-unavailable-${index}`,
          },
        });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: {
          code: "INVITATION_NOT_AVAILABLE",
          details: null,
          message: "Resource not found",
        },
        requestId: `req-unavailable-${index}`,
        timestamp: expect.any(String),
      });
      expect(response.body).not.toContain(testCase.credential);
      expect(response.body).not.toContain("ARCHIVED");
      expect(response.body).not.toContain("stale");
    }

    await expect(
      getInvitationState(staleFixture.invitationId),
    ).resolves.toMatchObject({
      openCount: 0,
    });
    await expect(
      getInvitationState(archivedFixture.invitationId),
    ).resolves.toMatchObject({
      openCount: 0,
      status: InvitationStatus.ARCHIVED,
    });
  });

  it("redacts credential-bearing URLs in structured request logs", async () => {
    logEntries.length = 0;

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${VALID_UNKNOWN_CREDENTIAL}?token=QUERY-SECRET`,
        headers: {
          "x-request-id": "req-log-redaction",
        },
      });
    const logEntry = logEntries.at(-1);

    expect(response.statusCode).toBe(404);
    expect(logEntry).toMatchObject({
      method: "GET",
      requestId: "req-log-redaction",
      statusCode: 404,
      url: "/api/public/invitations/[REDACTED]?token=%5BREDACTED%5D",
    });
    expect(JSON.stringify(logEntry)).not.toContain(VALID_UNKNOWN_CREDENTIAL);
    expect(JSON.stringify(logEntry)).not.toContain("QUERY-SECRET");
  });

  it("creates an accepted RSVP over HTTP and does not expose credential-bearing pass fields", async () => {
    const fixture = await createFixture();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        headers: {
          "x-request-id": "req-rsvp-accepted",
        },
        method: "PUT",
        payload: {
          attendees: [
            {
              inviteeId: fixture.adultInviteeId,
              quantity: 1,
              type: "NAMED_INVITEE",
            },
            {
              quantity: 1,
              type: "PLUS_ONE",
            },
          ],
          dietaryNotes: "  Vegetarian  ",
          eventSelections: [
            {
              attending: true,
              eventId: fixture.linkedEventIdsByDisplayOrder[0],
              expectedAttendeeCount: 2,
            },
            {
              attending: false,
              eventId: fixture.linkedEventIdsByDisplayOrder[1],
              expectedAttendeeCount: 0,
            },
          ],
          expectedVersion: null,
          status: RSVPStatus.ACCEPTED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });
    const activePasses = await prisma.checkinPass.findMany({
      where: {
        invitationId: fixture.invitationId,
        status: CheckinPassStatus.ACTIVE,
      },
    });
    const invitationState = await getInvitationState(fixture.invitationId);

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req-rsvp-accepted");
    expect(response.json()).toMatchObject({
      checkinPass: {
        issuedAt: expect.any(String),
        qrPayload: expect.any(String),
        status: CheckinPassStatus.ACTIVE,
      },
      rsvp: {
        attendeeQuantityTotal: 2,
        attendees: [
          {
            inviteeId: fixture.adultInviteeId,
            quantity: 1,
            type: "NAMED_INVITEE",
          },
          {
            inviteeId: null,
            quantity: 1,
            type: "PLUS_ONE",
          },
        ],
        dietaryNotes: "Vegetarian",
        status: RSVPStatus.ACCEPTED,
        version: 1,
      },
    });
    expect(response.json().rsvp.eventSelections).toEqual([
      {
        attending: true,
        eventId: fixture.linkedEventIdsByDisplayOrder[0],
        expectedAttendeeCount: 2,
      },
      {
        attending: false,
        eventId: fixture.linkedEventIdsByDisplayOrder[1],
        expectedAttendeeCount: 0,
      },
    ]);
    expect(activePasses).toHaveLength(1);
    expect(response.json().checkinPass.qrPayload).toMatch(
      DERIVED_CREDENTIAL_PATTERN,
    );
    expect(hashDerivedCredential(response.json().checkinPass.qrPayload)).toBe(
      activePasses[0]!.tokenHash,
    );
    expect(invitationState.openCount).toBe(0);
    expect(response.body).not.toContain("tokenHash");
    expect(response.body).not.toContain("credentialVersion");
    expect(response.body).not.toContain(activePasses[0]?.tokenHash ?? "");
    expect(response.body).not.toContain(activePasses[0]?.id ?? "");
    expect(response.body).not.toContain(fixture.invitationId);
  });

  it("returns the current RSVP state over HTTP without recording an invitation open", async () => {
    const fixture = await createFixture();
    const putResponse = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: RSVPStatus.DECLINED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(putResponse.statusCode).toBe(200);

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });
    const invitationState = await getInvitationState(fixture.invitationId);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      checkinPass: null,
      canEdit: true,
      editBlockedReason: null,
      rsvp: {
        attendeeQuantityTotal: 0,
        attendees: [],
        dietaryNotes: null,
        eventSelections: [],
        status: RSVPStatus.DECLINED,
        version: 1,
      },
    });
    expect(invitationState.openCount).toBe(0);
    expect(response.body).not.toContain("tokenHash");
    expect(response.body).not.toContain("credentialVersion");
    expect(response.body).not.toContain("qrPayload");
  });

  it("returns null RSVP state from the dedicated RSVP GET before a household responds", async () => {
    const fixture = await createFixture();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      checkinPass: null,
      rsvp: null,
      canEdit: true,
      editBlockedReason: null,
    });
    expect(response.body).not.toContain("tokenHash");
    expect(response.body).not.toContain("credentialVersion");
    expect(response.body).not.toContain("qrPayload");
  });

  it("returns accepted RSVP state from the dedicated RSVP GET", async () => {
    const fixture = await createFixture();
    const accepted = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [
            {
              inviteeId: fixture.adultInviteeId,
              quantity: 1,
              type: "NAMED_INVITEE",
            },
          ],
          eventSelections: [
            {
              attending: true,
              eventId: fixture.linkedEventIdsByDisplayOrder[0],
              expectedAttendeeCount: 1,
            },
          ],
          expectedVersion: null,
          status: RSVPStatus.ACCEPTED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });
    expect(accepted.statusCode).toBe(200);
    const [activePass] = await prisma.checkinPass.findMany({
      where: {
        invitationId: fixture.invitationId,
        status: CheckinPassStatus.ACTIVE,
      },
    });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      checkinPass: {
        issuedAt: expect.any(String),
        qrPayload: expect.any(String),
        status: CheckinPassStatus.ACTIVE,
      },
      rsvp: {
        attendeeQuantityTotal: 1,
        attendees: [
          {
            inviteeId: fixture.adultInviteeId,
            quantity: 1,
            type: "NAMED_INVITEE",
          },
        ],
        dietaryNotes: null,
        status: RSVPStatus.ACCEPTED,
        version: 1,
      },
    });
    expect(hashDerivedCredential(response.json().checkinPass.qrPayload)).toBe(
      activePass!.tokenHash,
    );
    expect(response.body).not.toContain("tokenHash");
    expect(response.body).not.toContain("credentialVersion");
    expect(response.body).not.toContain(activePass!.id);
    expect(response.body).not.toContain(fixture.invitationId);
  });

  it("maps unavailable dedicated RSVP GET credentials to the generic 404 envelope", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/api/public/invitations/bad/rsvp",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "INVITATION_NOT_AVAILABLE",
        details: null,
        message: "Resource not found",
      },
    });
    expect(response.body).not.toContain("bad");
  });

  it("updates an existing public RSVP with the current expectedVersion", async () => {
    const fixture = await createFixture();
    await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: RSVPStatus.DECLINED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [
            {
              inviteeId: fixture.childInviteeId,
              quantity: 1,
              type: "NAMED_INVITEE",
            },
          ],
          dietaryNotes: null,
          eventSelections: [
            {
              attending: true,
              eventId: fixture.linkedEventIdsByDisplayOrder[0],
              expectedAttendeeCount: 1,
            },
          ],
          expectedVersion: 1,
          status: RSVPStatus.ACCEPTED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      checkinPass: {
        qrPayload: expect.any(String),
        status: CheckinPassStatus.ACTIVE,
      },
      rsvp: {
        attendeeQuantityTotal: 1,
        status: RSVPStatus.ACCEPTED,
        version: 2,
      },
    });
  });

  it("returns qrPayload according to the public pass lifecycle over HTTP", async () => {
    const fixture = await createFixture();
    const acceptPayload = {
      attendees: [
        {
          inviteeId: fixture.adultInviteeId,
          quantity: 1,
          type: "NAMED_INVITEE",
        },
      ],
      eventSelections: [
        {
          attending: true,
          eventId: fixture.linkedEventIdsByDisplayOrder[0],
          expectedAttendeeCount: 1,
        },
      ],
      status: RSVPStatus.ACCEPTED,
    };

    const firstAccept = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          ...acceptPayload,
          dietaryNotes: "first",
          expectedVersion: null,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });
    expect(firstAccept.statusCode).toBe(200);
    const firstPass = await prisma.checkinPass.findFirstOrThrow({
      where: {
        invitationId: fixture.invitationId,
        status: CheckinPassStatus.ACTIVE,
      },
    });
    const firstPayload = firstAccept.json().checkinPass.qrPayload;

    expect(hashDerivedCredential(firstPayload)).toBe(firstPass.tokenHash);

    const acceptedUpdate = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          ...acceptPayload,
          dietaryNotes: "second",
          expectedVersion: 1,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(acceptedUpdate.statusCode).toBe(200);
    expect(acceptedUpdate.json().checkinPass.qrPayload).toBe(firstPayload);
    await expect(
      prisma.checkinPass.count({
        where: { invitationId: fixture.invitationId },
      }),
    ).resolves.toBe(1);

    const decline = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: 2,
          status: RSVPStatus.DECLINED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(decline.statusCode).toBe(200);
    expect(decline.json().checkinPass).toBeNull();

    const reaccept = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          ...acceptPayload,
          dietaryNotes: "third",
          expectedVersion: 3,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });
    const activePass = await prisma.checkinPass.findFirstOrThrow({
      where: {
        invitationId: fixture.invitationId,
        status: CheckinPassStatus.ACTIVE,
      },
    });
    const allPasses = await prisma.checkinPass.findMany({
      where: { invitationId: fixture.invitationId },
    });

    expect(reaccept.statusCode).toBe(200);
    expect(hashDerivedCredential(reaccept.json().checkinPass.qrPayload)).toBe(
      activePass.tokenHash,
    );
    expect(reaccept.json().checkinPass.qrPayload).not.toBe(firstPayload);
    expect(allPasses).toHaveLength(2);
    expect(
      allPasses.filter((pass) => pass.status === CheckinPassStatus.REVOKED),
    ).toHaveLength(1);
  });

  it("rejects public RSVP submissions after the persisted deadline", async () => {
    const fixture = await createFixture({
      rsvpDeadlineAt: new Date(TEST_NOW.getTime() - 1),
    });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: RSVPStatus.DECLINED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "RSVP_DEADLINE_PASSED",
        details: null,
        message: "RSVP deadline passed",
      },
    });
  });

  it.each([
    { label: "before", offset: -1, status: 200 },
    { label: "at", offset: 0, status: 200 },
    { label: "after", offset: 1, status: 422 },
  ])(
    "enforces the inclusive UTC deadline $label the cutoff",
    async ({ offset, status }) => {
      const fixture = await createFixture({ rsvpDeadlineAt: FIXTURE_DEADLINE });
      rsvpNow = new Date(FIXTURE_DEADLINE.getTime() + offset);
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: "PUT",
          payload: {
            attendees: [],
            eventSelections: [],
            expectedVersion: null,
            status: RSVPStatus.DECLINED,
          },
          url: `/api/public/invitations/${fixture.credential}/rsvp`,
        });
      expect(response.statusCode).toBe(status);
      const rsvp = await prisma.rSVP.findUnique({
        where: { invitationId: fixture.invitationId },
      });
      if (offset > 0) {
        expect(response.json().error.code).toBe("RSVP_DEADLINE_PASSED");
        expect(rsvp).toBeNull();
      } else {
        expect(rsvp?.status).toBe(RSVPStatus.DECLINED);
        expect(rsvp?.version).toBe(1);
      }
      await expect(
        prisma.checkinPass.count({
          where: { invitationId: fixture.invitationId },
        }),
      ).resolves.toBe(0);
    },
  );

  it("rejects event selections outside the invitation eligibility list", async () => {
    const fixture = await createFixture();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [
            {
              inviteeId: fixture.adultInviteeId,
              quantity: 1,
              type: "NAMED_INVITEE",
            },
          ],
          eventSelections: [
            {
              attending: true,
              eventId: randomUUID(),
              expectedAttendeeCount: 1,
            },
          ],
          expectedVersion: null,
          status: RSVPStatus.ACCEPTED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "EVENT_NOT_ALLOWED",
        details: null,
        message: "Event is not allowed",
      },
    });
  });

  it("transitions an accepted public RSVP to declined and removes active pass exposure", async () => {
    const fixture = await createFixture();
    await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [
            {
              inviteeId: fixture.adultInviteeId,
              quantity: 1,
              type: "NAMED_INVITEE",
            },
          ],
          eventSelections: [
            {
              attending: true,
              eventId: fixture.linkedEventIdsByDisplayOrder[0],
              expectedAttendeeCount: 1,
            },
          ],
          expectedVersion: null,
          status: RSVPStatus.ACCEPTED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: 1,
          status: RSVPStatus.DECLINED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });
    const activePasses = await prisma.checkinPass.findMany({
      where: {
        invitationId: fixture.invitationId,
        status: CheckinPassStatus.ACTIVE,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      checkinPass: null,
      rsvp: {
        attendeeQuantityTotal: 0,
        attendees: [],
        dietaryNotes: null,
        eventSelections: [],
        status: RSVPStatus.DECLINED,
        version: 2,
      },
    });
    expect(activePasses).toHaveLength(0);
    expect(response.body).not.toContain("tokenHash");
    expect(response.body).not.toContain("credentialVersion");
    expect(response.body).not.toContain("qrPayload");
  });

  it("maps stale public RSVP versions to a 409 error envelope", async () => {
    const fixture = await createFixture();
    await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: RSVPStatus.DECLINED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: RSVPStatus.DECLINED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "RSVP_VERSION_CONFLICT",
        details: null,
        message: "RSVP version conflict",
      },
    });
  });

  it("maps public RSVP domain validation failures to a 422 error envelope", async () => {
    const fixture = await createFixture();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: RSVPStatus.ACCEPTED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "EVENT_NOT_SELECTED",
        details: null,
        message: "Event is not selected",
      },
    });
  });

  it("maps malformed public RSVP payloads to a 400 error envelope", async () => {
    const fixture = await createFixture();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [
            {
              attending: true,
              eventId: "not-a-uuid",
              expectedAttendeeCount: 1,
            },
          ],
          expectedVersion: null,
          status: RSVPStatus.ACCEPTED,
        },
        url: `/api/public/invitations/${fixture.credential}/rsvp`,
      });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "BAD_REQUEST",
        details: null,
        message: "Bad request",
      },
    });
    expect(response.body).not.toContain(fixture.credential);
  });

  it("treats unavailable RSVP credentials as the same 404 classification", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: RSVPStatus.DECLINED,
        },
        url: `/api/public/invitations/bad/rsvp`,
      });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: "INVITATION_NOT_AVAILABLE",
        details: null,
        message: "Resource not found",
      },
    });
    expect(response.body).not.toContain("bad");
  });
});
