import { randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDatabaseUrl } from "../database/database-url.js";
import type { PrismaService } from "../database/prisma.service.js";
import {
  CheckinPassStatus,
  InvitationStatus,
  InviteeCategory,
  PrismaClient,
  RSVPAttendeeType,
  RSVPStatus,
} from "../generated/prisma/client.js";
import type { CredentialSecretProvider } from "../security/credential-secret.provider.js";
import {
  CredentialService,
  deriveCredentialWithSecret,
} from "../security/credential.service.js";
import type {
  CredentialLookupHash,
  DerivedCredential,
} from "../security/credential.types.js";
import {
  PublicRsvpDomainError,
  type PublicRsvpErrorCode,
} from "./public-rsvp.errors.js";
import {
  PublicRsvpService,
  type SubmitPublicRsvpCommand,
} from "./public-rsvp.service.js";

const TEST_SECRET_BYTES = Buffer.from(
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  "base64url",
);
const DEFAULT_NOW = new Date("2026-12-25T16:59:59.000Z");
const FUTURE_DEADLINE = new Date("2026-12-25T17:00:00.000Z");

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const credentialService = new CredentialService({
  getSecretKey: () => Buffer.from(TEST_SECRET_BYTES),
} as CredentialSecretProvider);

let currentTime = new Date(DEFAULT_NOW);
const service = new PublicRsvpService(
  prisma as unknown as PrismaService,
  credentialService,
  () => currentTime,
);

const createdInvitationIds: string[] = [];
const createdEventIds: string[] = [];

type Fixture = {
  adultInviteeId: string;
  childInviteeId: string;
  credential: DerivedCredential;
  eventId: string;
  invitationId: string;
  lookupHash: CredentialLookupHash;
  secondEventId: string;
  unlinkedEventId: string;
};

function createCredential(stableId: string): DerivedCredential {
  return deriveCredentialWithSecret(
    {
      namespace: "invitation",
      stableId,
      version: 1,
    },
    TEST_SECRET_BYTES,
  );
}

function createLookupHash(credential: DerivedCredential): CredentialLookupHash {
  return credentialService.hashCredential(credential);
}

function uniqueDisplayOrderBase(): number {
  return randomInt(1, 1_000_000_000);
}

async function createFixture(
  options: {
    allowPlusOne?: boolean;
    maxAdditionalChildren?: number;
    rsvpDeadlineAt?: Date | null;
    status?: InvitationStatus;
  } = {},
): Promise<Fixture> {
  const invitationId = randomUUID();
  const credential = createCredential(invitationId);
  const lookupHash = createLookupHash(credential);
  const suffix = randomUUID();
  const displayOrderBase = uniqueDisplayOrderBase();

  const invitation = await prisma.invitation.create({
    data: {
      allowPlusOne: options.allowPlusOne ?? true,
      displayName: `RSVP Household ${suffix}`,
      id: invitationId,
      maxAdditionalChildren: options.maxAdditionalChildren ?? 2,
      publicTokenHash: lookupHash,
      rsvpDeadlineAt: options.rsvpDeadlineAt ?? FUTURE_DEADLINE,
      status: options.status ?? InvitationStatus.ACTIVE,
    },
  });
  createdInvitationIds.push(invitation.id);

  const event = await prisma.event.create({
    data: {
      displayOrder: displayOrderBase + 10,
      name: "Ceremony",
      slug: `rsvp-ceremony-${suffix}`,
    },
  });
  const secondEvent = await prisma.event.create({
    data: {
      displayOrder: displayOrderBase + 20,
      name: "Reception",
      slug: `rsvp-reception-${suffix}`,
    },
  });
  const unlinkedEvent = await prisma.event.create({
    data: {
      displayOrder: displayOrderBase + 30,
      name: "Foreign Event",
      slug: `rsvp-foreign-${suffix}`,
    },
  });
  createdEventIds.push(event.id, secondEvent.id, unlinkedEvent.id);

  await prisma.invitationEvent.createMany({
    data: [
      {
        eventId: event.id,
        invitationId: invitation.id,
      },
      {
        eventId: secondEvent.id,
        invitationId: invitation.id,
      },
    ],
  });

  const adultInvitee = await prisma.invitee.create({
    data: {
      category: InviteeCategory.ADULT,
      displayOrder: 10,
      fullName: "Adult Guest",
      invitationId: invitation.id,
    },
  });
  const childInvitee = await prisma.invitee.create({
    data: {
      category: InviteeCategory.CHILD,
      displayOrder: 20,
      fullName: "Child Guest",
      invitationId: invitation.id,
    },
  });

  return {
    adultInviteeId: adultInvitee.id,
    childInviteeId: childInvitee.id,
    credential,
    eventId: event.id,
    invitationId: invitation.id,
    lookupHash,
    secondEventId: secondEvent.id,
    unlinkedEventId: unlinkedEvent.id,
  };
}

function acceptedCommand(
  fixture: Fixture,
  override: Partial<SubmitPublicRsvpCommand> = {},
): SubmitPublicRsvpCommand {
  return {
    attendees: [
      {
        inviteeId: fixture.adultInviteeId,
        quantity: 1,
        type: RSVPAttendeeType.NAMED_INVITEE,
      },
    ],
    dietaryNotes: "  No seafood  ",
    eventSelections: [
      {
        attending: true,
        eventId: fixture.eventId,
        expectedAttendeeCount: 1,
      },
    ],
    expectedVersion: null,
    publicCredential: fixture.credential,
    status: RSVPStatus.ACCEPTED,
    ...override,
  };
}

function declinedCommand(
  fixture: Fixture,
  override: Partial<SubmitPublicRsvpCommand> = {},
): SubmitPublicRsvpCommand {
  return {
    attendees: [],
    dietaryNotes: "ignored on decline",
    eventSelections: [],
    expectedVersion: null,
    publicCredential: fixture.credential,
    status: RSVPStatus.DECLINED,
    ...override,
  };
}

function expectDomainError(
  action: Promise<unknown>,
  code: PublicRsvpErrorCode,
) {
  return expect(action).rejects.toMatchObject({
    code,
    details: null,
    name: "PublicRsvpDomainError",
  });
}

function getRejectedDomainCode(result: PromiseSettledResult<unknown>) {
  if (result.status !== "rejected") {
    return null;
  }

  return result.reason instanceof PublicRsvpDomainError
    ? result.reason.code
    : null;
}

async function getRsvp(invitationId: string) {
  return prisma.rSVP.findUniqueOrThrow({
    where: { invitationId },
    select: {
      attendees: true,
      dietaryNotes: true,
      eventSelections: true,
      guestNote: true,
      id: true,
      status: true,
      version: true,
    },
  });
}

async function getActivePasses(invitationId: string) {
  return prisma.checkinPass.findMany({
    where: {
      invitationId,
      status: CheckinPassStatus.ACTIVE,
    },
    orderBy: {
      issuedAt: "asc",
    },
  });
}

async function getAllPasses(invitationId: string) {
  return prisma.checkinPass.findMany({
    where: { invitationId },
    orderBy: {
      issuedAt: "asc",
    },
  });
}

async function cleanupFixtures() {
  if (createdInvitationIds.length === 0 && createdEventIds.length === 0) {
    return;
  }

  await prisma.checkinRecord.deleteMany({
    where: {
      invitationId: { in: createdInvitationIds },
    },
  });
  await prisma.checkinPass.deleteMany({
    where: {
      invitationId: { in: createdInvitationIds },
    },
  });
  await prisma.rSVP.deleteMany({
    where: {
      invitationId: { in: createdInvitationIds },
    },
  });
  await prisma.invitationEvent.deleteMany({
    where: {
      OR: [
        {
          invitationId: { in: createdInvitationIds },
        },
        {
          eventId: { in: createdEventIds },
        },
      ],
    },
  });
  await prisma.invitee.deleteMany({
    where: {
      invitationId: { in: createdInvitationIds },
    },
  });
  await prisma.invitation.deleteMany({
    where: {
      id: { in: createdInvitationIds },
    },
  });
  await prisma.event.deleteMany({
    where: {
      id: { in: createdEventIds },
    },
  });

  createdInvitationIds.length = 0;
  createdEventIds.length = 0;
}

afterEach(async () => {
  currentTime = new Date(DEFAULT_NOW);
  await cleanupFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("PublicRsvpService", () => {
  it("creates a first ACCEPTED RSVP with version 1 and one active pass", async () => {
    const fixture = await createFixture();

    const result = await service.submitPublicRsvp(acceptedCommand(fixture));
    const rsvp = await getRsvp(fixture.invitationId);
    const [pass] = await getActivePasses(fixture.invitationId);

    expect(result).toMatchObject({
      checkinPass: {
        status: CheckinPassStatus.ACTIVE,
      },
      rsvp: {
        attendeeQuantityTotal: 1,
        dietaryNotes: "No seafood",
        status: RSVPStatus.ACCEPTED,
        version: 1,
      },
    });
    expect(rsvp).toMatchObject({
      dietaryNotes: "No seafood",
      status: RSVPStatus.ACCEPTED,
      version: 1,
    });
    expect(rsvp.attendees).toHaveLength(1);
    expect(rsvp.eventSelections).toHaveLength(1);
    expect(pass).toBeDefined();
    expect(pass?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pass?.tokenHash).not.toBe(fixture.credential);
    expect(JSON.stringify(result)).not.toContain("tokenHash");
  });

  it("creates a first DECLINED RSVP with clean state and no active pass", async () => {
    const fixture = await createFixture();

    const result = await service.submitPublicRsvp(declinedCommand(fixture));
    const rsvp = await getRsvp(fixture.invitationId);

    expect(result).toEqual({
      checkinPass: null,
      rsvp: {
        attendeeQuantityTotal: 0,
        attendees: [],
        dietaryNotes: null,
        eventSelections: [],
        status: RSVPStatus.DECLINED,
        version: 1,
      },
    });
    expect(rsvp.status).toBe(RSVPStatus.DECLINED);
    expect(rsvp.version).toBe(1);
    expect(rsvp.dietaryNotes).toBeNull();
    expect(rsvp.attendees).toHaveLength(0);
    expect(rsvp.eventSelections).toHaveLength(0);
    expect(await getActivePasses(fixture.invitationId)).toHaveLength(0);
  });

  it("rejects non-null expectedVersion when no RSVP exists", async () => {
    const fixture = await createFixture();

    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          expectedVersion: 1,
        }),
      ),
      "RSVP_VERSION_CONFLICT",
    );

    await expect(
      prisma.rSVP.findUnique({ where: { invitationId: fixture.invitationId } }),
    ).resolves.toBeNull();
  });

  it("updates an existing RSVP with exact version and preserves guestNote", async () => {
    const fixture = await createFixture();
    await service.submitPublicRsvp(acceptedCommand(fixture));
    const firstRsvp = await getRsvp(fixture.invitationId);
    await prisma.rSVP.update({
      data: { guestNote: "Please keep this note." },
      where: { id: firstRsvp.id },
    });

    const result = await service.submitPublicRsvp(
      acceptedCommand(fixture, {
        dietaryNotes: "  Vegetarian  ",
        expectedVersion: 1,
      }),
    );
    const rsvp = await getRsvp(fixture.invitationId);

    expect(result.rsvp.version).toBe(2);
    expect(result.rsvp.dietaryNotes).toBe("Vegetarian");
    expect(rsvp.version).toBe(2);
    expect(rsvp.guestNote).toBe("Please keep this note.");
  });

  it("rejects stale and null expectedVersion for existing RSVP without writes", async () => {
    const fixture = await createFixture();
    await service.submitPublicRsvp(acceptedCommand(fixture));
    await service.submitPublicRsvp(
      acceptedCommand(fixture, {
        dietaryNotes: "updated once",
        expectedVersion: 1,
      }),
    );

    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          dietaryNotes: "stale",
          expectedVersion: 1,
        }),
      ),
      "RSVP_VERSION_CONFLICT",
    );
    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          dietaryNotes: "null conflict",
          expectedVersion: null,
        }),
      ),
      "RSVP_VERSION_CONFLICT",
    );

    const rsvp = await getRsvp(fixture.invitationId);
    expect(rsvp.version).toBe(2);
    expect(rsvp.dietaryNotes).toBe("updated once");
  });

  it("enforces the persisted deadline inclusively and rolls back after cutoff", async () => {
    const atCutoff = await createFixture({
      rsvpDeadlineAt: new Date(DEFAULT_NOW),
    });
    await expect(
      service.submitPublicRsvp(acceptedCommand(atCutoff)),
    ).resolves.toMatchObject({
      rsvp: { version: 1 },
    });

    const afterCutoff = await createFixture({
      rsvpDeadlineAt: new Date(DEFAULT_NOW),
    });
    currentTime = new Date(DEFAULT_NOW.getTime() + 1);

    await expectDomainError(
      service.submitPublicRsvp(acceptedCommand(afterCutoff)),
      "RSVP_DEADLINE_PASSED",
    );
    await expect(
      prisma.rSVP.findUnique({
        where: { invitationId: afterCutoff.invitationId },
      }),
    ).resolves.toBeNull();
    expect(await getActivePasses(afterCutoff.invitationId)).toHaveLength(0);
  });

  it("validates eligible attending events and expected attendee counts", async () => {
    const fixture = await createFixture();

    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          eventSelections: [
            {
              attending: false,
              eventId: fixture.eventId,
              expectedAttendeeCount: 0,
            },
          ],
        }),
      ),
      "EVENT_NOT_SELECTED",
    );
    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          eventSelections: [
            {
              attending: true,
              eventId: fixture.unlinkedEventId,
              expectedAttendeeCount: 1,
            },
          ],
        }),
      ),
      "EVENT_NOT_ALLOWED",
    );
    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          eventSelections: [
            {
              attending: true,
              eventId: fixture.eventId,
              expectedAttendeeCount: 2,
            },
          ],
        }),
      ),
      "RSVP_ATTENDEE_INVALID",
    );
  });

  it("validates named invitees and companion permissions", async () => {
    const fixture = await createFixture({ allowPlusOne: false });
    const foreign = await createFixture();

    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          attendees: [
            {
              inviteeId: foreign.adultInviteeId,
              quantity: 1,
              type: RSVPAttendeeType.NAMED_INVITEE,
            },
          ],
        }),
      ),
      "RSVP_ATTENDEE_INVALID",
    );
    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          attendees: [
            {
              quantity: 1,
              type: RSVPAttendeeType.PLUS_ONE,
            },
          ],
        }),
      ),
      "PLUS_ONE_NOT_ALLOWED",
    );
  });

  it("accepts plus-one and additional children only within locked limits", async () => {
    const fixture = await createFixture({
      allowPlusOne: true,
      maxAdditionalChildren: 2,
    });

    const result = await service.submitPublicRsvp(
      acceptedCommand(fixture, {
        attendees: [
          {
            inviteeId: fixture.adultInviteeId,
            quantity: 1,
            type: RSVPAttendeeType.NAMED_INVITEE,
          },
          {
            quantity: 1,
            type: RSVPAttendeeType.PLUS_ONE,
          },
          {
            quantity: 2,
            type: RSVPAttendeeType.ADDITIONAL_CHILD,
          },
        ],
        eventSelections: [
          {
            attending: true,
            eventId: fixture.eventId,
            expectedAttendeeCount: 4,
          },
        ],
      }),
    );

    expect(result.rsvp.attendeeQuantityTotal).toBe(4);

    const overLimitFixture = await createFixture({
      maxAdditionalChildren: 1,
    });
    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(overLimitFixture, {
          attendees: [
            {
              inviteeId: overLimitFixture.adultInviteeId,
              quantity: 1,
              type: RSVPAttendeeType.NAMED_INVITEE,
            },
            {
              quantity: 2,
              type: RSVPAttendeeType.ADDITIONAL_CHILD,
            },
          ],
        }),
      ),
      "ADDITIONAL_CHILD_LIMIT_EXCEEDED",
    );
  });

  it("normalizes dietary notes and rejects overlong values", async () => {
    const emptyFixture = await createFixture();

    const emptyResult = await service.submitPublicRsvp(
      acceptedCommand(emptyFixture, {
        dietaryNotes: "   ",
      }),
    );
    expect(emptyResult.rsvp.dietaryNotes).toBeNull();

    const maxFixture = await createFixture();
    const maxResult = await service.submitPublicRsvp(
      acceptedCommand(maxFixture, {
        dietaryNotes: ` ${"a".repeat(500)} `,
      }),
    );
    expect(maxResult.rsvp.dietaryNotes).toHaveLength(500);

    const overFixture = await createFixture();
    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(overFixture, {
          dietaryNotes: "a".repeat(501),
        }),
      ),
      "RSVP_ATTENDEE_INVALID",
    );
  });

  it("retains pass on accepted update, revokes on decline, and issues a new pass on re-accept", async () => {
    const fixture = await createFixture();
    await service.submitPublicRsvp(acceptedCommand(fixture));
    const [firstPass] = await getActivePasses(fixture.invitationId);
    const firstRsvp = await getRsvp(fixture.invitationId);
    await prisma.rSVP.update({
      data: { guestNote: "survives decline" },
      where: { id: firstRsvp.id },
    });

    await service.submitPublicRsvp(
      acceptedCommand(fixture, {
        expectedVersion: 1,
      }),
    );
    expect(await getActivePasses(fixture.invitationId)).toMatchObject([
      { id: firstPass?.id },
    ]);

    await service.submitPublicRsvp(
      declinedCommand(fixture, {
        expectedVersion: 2,
      }),
    );
    expect(await getActivePasses(fixture.invitationId)).toHaveLength(0);
    let rsvp = await getRsvp(fixture.invitationId);
    expect(rsvp.attendees).toHaveLength(0);
    expect(rsvp.eventSelections).toHaveLength(0);
    expect(rsvp.dietaryNotes).toBeNull();
    expect(rsvp.guestNote).toBe("survives decline");

    await service.submitPublicRsvp(
      acceptedCommand(fixture, {
        expectedVersion: 3,
      }),
    );
    const passes = await getAllPasses(fixture.invitationId);
    const activePasses = passes.filter(
      (pass) => pass.status === CheckinPassStatus.ACTIVE,
    );
    const revokedPasses = passes.filter(
      (pass) => pass.status === CheckinPassStatus.REVOKED,
    );

    expect(activePasses).toHaveLength(1);
    expect(revokedPasses).toHaveLength(1);
    expect(activePasses[0]?.id).not.toBe(firstPass?.id);
    expect(activePasses[0]?.tokenHash).not.toBe(firstPass?.tokenHash);

    await service.submitPublicRsvp(
      declinedCommand(fixture, {
        expectedVersion: 4,
      }),
    );
    await service.submitPublicRsvp(
      declinedCommand(fixture, {
        expectedVersion: 5,
      }),
    );
    rsvp = await getRsvp(fixture.invitationId);
    expect(rsvp.version).toBe(6);
    expect(await getActivePasses(fixture.invitationId)).toHaveLength(0);
  });

  it("rolls back pass and RSVP changes on validation failure", async () => {
    const fixture = await createFixture();
    await service.submitPublicRsvp(acceptedCommand(fixture));
    const [pass] = await getActivePasses(fixture.invitationId);

    await expectDomainError(
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          attendees: [],
          expectedVersion: 1,
        }),
      ),
      "RSVP_ATTENDEE_INVALID",
    );

    const rsvp = await getRsvp(fixture.invitationId);
    expect(rsvp.version).toBe(1);
    expect(await getActivePasses(fixture.invitationId)).toMatchObject([
      { id: pass?.id },
    ]);
  });

  it("serializes two first-time create requests so one succeeds and one conflicts", async () => {
    const fixture = await createFixture();
    const results = await Promise.allSettled([
      service.submitPublicRsvp(acceptedCommand(fixture)),
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          dietaryNotes: "second",
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.map(getRejectedDomainCode)).toContain("RSVP_VERSION_CONFLICT");

    const rsvp = await getRsvp(fixture.invitationId);
    expect(rsvp.version).toBe(1);
    expect(await getActivePasses(fixture.invitationId)).toHaveLength(1);
  });

  it("serializes same-version updates so one succeeds and one conflicts", async () => {
    const fixture = await createFixture();
    await service.submitPublicRsvp(acceptedCommand(fixture));

    const results = await Promise.allSettled([
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          dietaryNotes: "first update",
          expectedVersion: 1,
        }),
      ),
      service.submitPublicRsvp(
        acceptedCommand(fixture, {
          dietaryNotes: "second update",
          expectedVersion: 1,
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.map(getRejectedDomainCode)).toContain("RSVP_VERSION_CONFLICT");

    const rsvp = await getRsvp(fixture.invitationId);
    expect(rsvp.version).toBe(2);
    expect(["first update", "second update"]).toContain(rsvp.dietaryNotes);
    expect(await getActivePasses(fixture.invitationId)).toHaveLength(1);
  });
});
