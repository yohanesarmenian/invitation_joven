import { randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDatabaseUrl } from "../database/database-url.js";
import { PrismaClient } from "../generated/prisma/client.js";
import {
  InvitationStatus,
  InviteeCategory,
  RSVPStatus,
} from "../generated/prisma/enums.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { CredentialSecretProvider } from "../security/credential-secret.provider.js";
import {
  CredentialService,
  deriveCredentialWithSecret,
} from "../security/credential.service.js";
import type {
  CredentialLookupHash,
  DerivedCredential,
} from "../security/credential.types.js";
import { InvitationNotAvailableError } from "./invitation-not-available.error.js";
import {
  PublicInvitationService,
  readPublicInvitationProjectionForLookupHash,
} from "./public-invitation.service.js";

const TEST_SECRET_BYTES = Buffer.from(
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  "base64url",
);
const PARALLEL_OPEN_COUNT = 8;

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const credentialService = new CredentialService({
  getSecretKey: () => Buffer.from(TEST_SECRET_BYTES),
} as CredentialSecretProvider);
const service = new PublicInvitationService(
  prisma as unknown as PrismaService,
  credentialService,
);

const createdInvitationIds: string[] = [];
const createdEventIds: string[] = [];

interface PublicInvitationFixture {
  credential: DerivedCredential;
  invitationId: string;
  linkedEventIdsByDisplayOrder: string[];
  lookupHash: CredentialLookupHash;
  unlinkedEventId: string;
}

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

async function createFixture(options: {
  firstOpenedAt?: Date | null;
  lastOpenedAt?: Date | null;
  openCount?: number;
  status?: InvitationStatus;
  withRsvp?: boolean;
} = {}): Promise<PublicInvitationFixture> {
  const invitationId = randomUUID();
  const credential = createCredential(invitationId);
  const lookupHash = createLookupHash(credential);
  const suffix = randomUUID();
  const displayOrderBase = uniqueDisplayOrderBase();

  const invitation = await prisma.invitation.create({
    data: {
      id: invitationId,
      allowPlusOne: true,
      displayName: `Slice 3 Household ${suffix}`,
      firstOpenedAt: options.firstOpenedAt ?? null,
      greetingName: "Slice 3 Guests",
      lastOpenedAt: options.lastOpenedAt ?? null,
      maxAdditionalChildren: 2,
      openCount: options.openCount ?? 0,
      publicTokenHash: lookupHash,
      rsvpDeadlineAt: new Date("2026-11-01T12:00:00.000Z"),
      status: options.status ?? InvitationStatus.ACTIVE,
    },
  });
  createdInvitationIds.push(invitation.id);

  const highOrderEvent = await prisma.event.create({
    data: {
      displayOrder: displayOrderBase + 20,
      googleMapsUrl: "https://maps.example/reception",
      name: "Reception",
      slug: `slice3-reception-${suffix}`,
      startsAt: new Date("2026-12-12T12:00:00.000Z"),
      venueName: "Grand Ballroom",
    },
  });
  const lowOrderEvent = await prisma.event.create({
    data: {
      address: "123 Ceremony Street",
      displayOrder: displayOrderBase + 10,
      name: "Ceremony",
      slug: `slice3-ceremony-${suffix}`,
      startsAt: null,
      venueName: null,
    },
  });
  const unlinkedEvent = await prisma.event.create({
    data: {
      displayOrder: displayOrderBase + 30,
      name: "Unlinked Event",
      slug: `slice3-unlinked-${suffix}`,
    },
  });
  createdEventIds.push(highOrderEvent.id, lowOrderEvent.id, unlinkedEvent.id);

  await prisma.invitationEvent.createMany({
    data: [
      {
        eventId: highOrderEvent.id,
        invitationId: invitation.id,
      },
      {
        eventId: lowOrderEvent.id,
        invitationId: invitation.id,
      },
    ],
  });

  await prisma.invitee.createMany({
    data: [
      {
        category: InviteeCategory.CHILD,
        displayOrder: 20,
        fullName: "Second Guest",
        invitationId: invitation.id,
      },
      {
        category: InviteeCategory.ADULT,
        displayOrder: 10,
        fullName: "First Guest",
        invitationId: invitation.id,
      },
    ],
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
    credential,
    invitationId: invitation.id,
    linkedEventIdsByDisplayOrder: [lowOrderEvent.id, highOrderEvent.id],
    lookupHash,
    unlinkedEventId: unlinkedEvent.id,
  };
}

async function getInvitationState(invitationId: string) {
  const invitation = await prisma.invitation.findUniqueOrThrow({
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

  return invitation;
}

async function expectUnavailable(
  action: Promise<unknown>,
  forbiddenValues: readonly string[] = [],
) {
  try {
    await action;
    throw new Error("Expected invitation unavailable failure.");
  } catch (error) {
    expect(error).toBeInstanceOf(InvitationNotAvailableError);
    expect(error).toMatchObject({
      code: "INVITATION_NOT_AVAILABLE",
      details: null,
      message: "Resource not found",
    });

    const serialized = `${String(error)} ${JSON.stringify(error)}`;
    for (const forbiddenValue of forbiddenValues) {
      expect(serialized).not.toContain(forbiddenValue);
    }
    expect(serialized).not.toContain("ARCHIVED");
    expect(serialized).not.toContain("archived");
    expect(serialized).not.toContain("stale");
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function expectStillPending(
  promise: Promise<unknown>,
  milliseconds = 150,
): Promise<void> {
  await expect(
    Promise.race([
      promise.then(
        () => "settled",
        () => "settled",
      ),
      delay(milliseconds).then(() => "pending"),
    ]),
  ).resolves.toBe("pending");
}

async function cleanupFixtures() {
  if (createdInvitationIds.length === 0 && createdEventIds.length === 0) {
    return;
  }

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

afterEach(async () => {
  await cleanupFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("PublicInvitationService PostgreSQL retrieval", () => {
  it("retrieves an ACTIVE invitation projection, maps privacy-safe DTO fields, and records the first open", async () => {
    const fixture = await createFixture({ withRsvp: true });

    const response = await service.retrievePublicInvitation(fixture.credential);
    const state = await getInvitationState(fixture.invitationId);

    expect(response.invitation).toMatchObject({
      displayName: expect.stringContaining("Slice 3 Household"),
      greetingName: "Slice 3 Guests",
      rules: {
        allowPlusOne: true,
        maxAdditionalChildren: 2,
      },
      rsvp: {
        status: RSVPStatus.ACCEPTED,
        version: 3,
      },
    });
    expect(response.invitation.events.map(({ id }) => id)).toEqual(
      fixture.linkedEventIdsByDisplayOrder,
    );
    expect(response.invitation.events.map(({ id }) => id)).not.toContain(
      fixture.unlinkedEventId,
    );
    expect(response.invitation.invitees.map(({ fullName }) => fullName)).toEqual([
      "First Guest",
      "Second Guest",
    ]);
    expect(JSON.stringify(response)).not.toContain(fixture.invitationId);
    expect(JSON.stringify(response)).not.toContain(fixture.lookupHash);
    expect(JSON.stringify(response)).not.toContain("displayOrder");

    expect(state.openCount).toBe(1);
    expect(state.firstOpenedAt).toBeInstanceOf(Date);
    expect(state.lastOpenedAt).toBeInstanceOf(Date);
    expect(state.firstOpenedAt?.getTime()).toBe(state.lastOpenedAt?.getTime());
  });

  it("returns null RSVP when no persisted RSVP exists", async () => {
    const fixture = await createFixture();

    const response = await service.retrievePublicInvitation(fixture.credential);

    expect(response.invitation.rsvp).toBeNull();
  });

  it("increments repeated valid opens without changing first_opened_at", async () => {
    const fixture = await createFixture();

    await service.retrievePublicInvitation(fixture.credential);
    const afterFirst = await getInvitationState(fixture.invitationId);
    await service.retrievePublicInvitation(fixture.credential);
    const afterSecond = await getInvitationState(fixture.invitationId);

    expect(afterSecond.openCount).toBe(2);
    expect(afterSecond.firstOpenedAt?.getTime()).toBe(
      afterFirst.firstOpenedAt?.getTime(),
    );
    expect(afterSecond.lastOpenedAt?.getTime()).toBeGreaterThanOrEqual(
      afterFirst.lastOpenedAt?.getTime() ?? 0,
    );
  });

  it("treats malformed, unknown, stale, and archived credentials as the same unavailable classification", async () => {
    const fixture = await createFixture();
    const archivedFixture = await createFixture({
      firstOpenedAt: new Date("2026-01-01T00:00:00.000Z"),
      lastOpenedAt: new Date("2026-01-02T00:00:00.000Z"),
      openCount: 4,
      status: InvitationStatus.ARCHIVED,
    });
    const unknownCredential = createCredential(randomUUID());
    const staleCredential = createCredential(randomUUID());

    await expectUnavailable(service.retrievePublicInvitation("bad"), ["bad"]);
    await expectUnavailable(service.retrievePublicInvitation(unknownCredential), [
      unknownCredential,
    ]);
    await expectUnavailable(service.retrievePublicInvitation(staleCredential), [
      staleCredential,
    ]);
    await expectUnavailable(
      service.retrievePublicInvitation(archivedFixture.credential),
      [archivedFixture.credential, archivedFixture.lookupHash],
    );

    expect(await getInvitationState(fixture.invitationId)).toMatchObject({
      firstOpenedAt: null,
      lastOpenedAt: null,
      openCount: 0,
    });
    expect(await getInvitationState(archivedFixture.invitationId)).toMatchObject({
      firstOpenedAt: new Date("2026-01-01T00:00:00.000Z"),
      lastOpenedAt: new Date("2026-01-02T00:00:00.000Z"),
      openCount: 4,
    });
  });

  it("persists only the credential lookup hash, never the plaintext public credential", async () => {
    const fixture = await createFixture();

    await service.retrievePublicInvitation(fixture.credential);
    const state = await getInvitationState(fixture.invitationId);

    expect(state.publicTokenHash).toBe(fixture.lookupHash);
    expect(state.publicTokenHash).not.toBe(fixture.credential);
    expect(JSON.stringify(state)).not.toContain(fixture.credential);
  });

  it("does not lose increments across parallel valid opens", async () => {
    const fixture = await createFixture();

    await Promise.all(
      Array.from({ length: PARALLEL_OPEN_COUNT }, () =>
        service.retrievePublicInvitation(fixture.credential),
      ),
    );

    const state = await getInvitationState(fixture.invitationId);
    expect(state.openCount).toBe(PARALLEL_OPEN_COUNT);
    expect(state.firstOpenedAt).toBeInstanceOf(Date);
    expect(state.lastOpenedAt).toBeInstanceOf(Date);
  });

  it("rolls back the open aggregate when a post-update transaction failure occurs", async () => {
    const fixture = await createFixture();

    await expect(
      prisma.$transaction(async (tx) => {
        await readPublicInvitationProjectionForLookupHash(tx, fixture.lookupHash);
        throw new Error("controlled post-update failure");
      }),
    ).rejects.toThrow("controlled post-update failure");

    expect(await getInvitationState(fixture.invitationId)).toMatchObject({
      firstOpenedAt: null,
      lastOpenedAt: null,
      openCount: 0,
    });
  });
});

describe("PublicInvitationService PostgreSQL lock ordering", () => {
  it("rejects public retrieval when an archive transaction commits first", async () => {
    const fixture = await createFixture();
    let releaseArchive!: () => void;
    let archiveLocked!: () => void;
    const releaseArchivePromise = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    const archiveLockedPromise = new Promise<void>((resolve) => {
      archiveLocked = resolve;
    });

    const archivePromise = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "invitations"
          WHERE "id" = ${fixture.invitationId}::uuid
          FOR UPDATE
        `;
        await tx.$executeRaw`
          UPDATE "invitations"
          SET
            "status" = 'ARCHIVED',
            "archived_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${fixture.invitationId}::uuid
        `;
        archiveLocked();
        await releaseArchivePromise;
      },
      { timeout: 15_000 },
    );

    await archiveLockedPromise;
    const retrievalPromise = service.retrievePublicInvitation(fixture.credential);
    await expectStillPending(retrievalPromise);

    releaseArchive();
    await archivePromise;
    await expectUnavailable(retrievalPromise, [
      fixture.credential,
      fixture.lookupHash,
      fixture.invitationId,
    ]);

    expect(await getInvitationState(fixture.invitationId)).toMatchObject({
      openCount: 0,
      status: InvitationStatus.ARCHIVED,
    });
  });

  it("lets archive wait when the public open transaction locks first", async () => {
    const fixture = await createFixture();
    let releasePublicOpen!: () => void;
    let publicOpenRecorded!: () => void;
    const releasePublicOpenPromise = new Promise<void>((resolve) => {
      releasePublicOpen = resolve;
    });
    const publicOpenRecordedPromise = new Promise<void>((resolve) => {
      publicOpenRecorded = resolve;
    });

    const publicOpenPromise = prisma.$transaction(
      async (tx) => {
        await readPublicInvitationProjectionForLookupHash(tx, fixture.lookupHash);
        publicOpenRecorded();
        await releasePublicOpenPromise;
      },
      { timeout: 15_000 },
    );

    await publicOpenRecordedPromise;

    const archivePromise = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "id"
          FROM "invitations"
          WHERE "id" = ${fixture.invitationId}::uuid
          FOR UPDATE
        `;
        await tx.$executeRaw`
          UPDATE "invitations"
          SET
            "status" = 'ARCHIVED',
            "archived_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${fixture.invitationId}::uuid
        `;
      },
      { timeout: 15_000 },
    );

    await expectStillPending(archivePromise);

    releasePublicOpen();
    await publicOpenPromise;
    await archivePromise;

    expect(await getInvitationState(fixture.invitationId)).toMatchObject({
      openCount: 1,
      status: InvitationStatus.ARCHIVED,
    });
  });
});
