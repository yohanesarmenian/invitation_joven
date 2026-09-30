import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getDatabaseUrl } from "../database/database-url.js";
import type { PrismaService } from "../database/prisma.service.js";
import {
  InvitationStatus,
  PrismaClient,
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
import { InvitationNotAvailableError } from "../invitations/invitation-not-available.error.js";
import { PublicGuestMessageService } from "./public-guest-message.service.js";

const TEST_SECRET_BYTES = Buffer.from(
  "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  "base64url",
);

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const credentialService = new CredentialService({
  getSecretKey: () => Buffer.from(TEST_SECRET_BYTES),
} as CredentialSecretProvider);
const service = new PublicGuestMessageService(
  prisma as unknown as PrismaService,
  credentialService,
);

const createdInvitationIds: string[] = [];

type Fixture = {
  credential: DerivedCredential;
  invitationId: string;
  lookupHash: CredentialLookupHash;
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

async function createFixture(
  options: {
    rsvpDeadlineAt?: Date | null;
    rsvpGuestNote?: string | null;
    rsvpStatus?: RSVPStatus;
    status?: InvitationStatus;
  } = {},
): Promise<Fixture> {
  const invitationId = randomUUID();
  const credential = createCredential(invitationId);
  const lookupHash = createLookupHash(credential);

  const invitation = await prisma.invitation.create({
    data: {
      displayName: `Message Household ${randomUUID()}`,
      id: invitationId,
      publicTokenHash: lookupHash,
      rsvpDeadlineAt:
        options.rsvpDeadlineAt ?? new Date("2026-12-25T16:59:59.000Z"),
      status: options.status ?? InvitationStatus.ACTIVE,
    },
  });
  createdInvitationIds.push(invitation.id);

  if (options.rsvpStatus !== undefined) {
    await prisma.rSVP.create({
      data: {
        guestNote: options.rsvpGuestNote,
        invitationId: invitation.id,
        status: options.rsvpStatus,
        version: 1,
      },
    });
  }

  return {
    credential,
    invitationId: invitation.id,
    lookupHash,
  };
}

async function getMessages(invitationId: string) {
  return prisma.guestMessage.findMany({
    where: { invitationId },
    orderBy: { createdAt: "asc" },
  });
}

async function cleanupFixtures() {
  if (createdInvitationIds.length === 0) {
    return;
  }

  await prisma.guestMessage.deleteMany({
    where: { invitationId: { in: createdInvitationIds } },
  });
  await prisma.rSVP.deleteMany({
    where: { invitationId: { in: createdInvitationIds } },
  });
  await prisma.invitation.deleteMany({
    where: { id: { in: createdInvitationIds } },
  });

  createdInvitationIds.length = 0;
}

afterEach(async () => {
  await cleanupFixtures();
});

afterAll(async () => {
  await cleanupFixtures();
  await prisma.$disconnect();
});

describe("PublicGuestMessageService", () => {
  it("creates a named guest message with minimal public response and internal defaults", async () => {
    const fixture = await createFixture();

    const result = await service.submitPublicGuestMessage({
      authorName: "Jo",
      message: "<script>alert(1)</script>",
      publicCredential: fixture.credential,
    });
    const messages = await getMessages(fixture.invitationId);

    expect(result).toEqual({
      message: {
        createdAt: expect.any(String),
      },
    });
    expect(Object.keys(result.message)).toEqual(["createdAt"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      authorName: "Jo",
      invitationId: fixture.invitationId,
      isHidden: false,
      message: "<script>alert(1)</script>",
    });
    expect(JSON.stringify(result)).not.toContain(messages[0]!.id);
    expect(JSON.stringify(result)).not.toContain(fixture.invitationId);
    expect(JSON.stringify(result)).not.toContain("isHidden");
    expect(JSON.stringify(result)).not.toContain("<script>");
    expect(JSON.stringify(result)).not.toContain("Jo");
  });

  it("creates anonymous multiline messages without an RSVP", async () => {
    const fixture = await createFixture();

    await service.submitPublicGuestMessage({
      authorName: null,
      message: "Hello\n\nCongratulations!",
      publicCredential: fixture.credential,
    });

    await expect(getMessages(fixture.invitationId)).resolves.toMatchObject([
      {
        authorName: null,
        message: "Hello\n\nCongratulations!",
      },
    ]);
  });

  it("allows submissions for accepted, declined, and past-deadline active invitations", async () => {
    const noRsvp = await createFixture();
    const accepted = await createFixture({ rsvpStatus: RSVPStatus.ACCEPTED });
    const declined = await createFixture({ rsvpStatus: RSVPStatus.DECLINED });
    const pastDeadline = await createFixture({
      rsvpDeadlineAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    for (const fixture of [noRsvp, accepted, declined, pastDeadline]) {
      await expect(
        service.submitPublicGuestMessage({
          authorName: null,
          message: "Best wishes",
          publicCredential: fixture.credential,
        }),
      ).resolves.toMatchObject({
        message: { createdAt: expect.any(String) },
      });
      await expect(getMessages(fixture.invitationId)).resolves.toHaveLength(1);
    }
  });

  it("rejects archived, unknown, and malformed credentials without writing messages", async () => {
    const archived = await createFixture({ status: InvitationStatus.ARCHIVED });
    const unknownCredential = createCredential(randomUUID());

    for (const credential of [archived.credential, unknownCredential, "bad"]) {
      await expect(
        service.submitPublicGuestMessage({
          authorName: null,
          message: "Best wishes",
          publicCredential: credential,
        }),
      ).rejects.toBeInstanceOf(InvitationNotAvailableError);
    }

    await expect(getMessages(archived.invitationId)).resolves.toHaveLength(0);
  });

  it("treats duplicate explicit submissions as append-only rows", async () => {
    const fixture = await createFixture();
    const command = {
      authorName: "Jo",
      message: "Duplicate by explicit submit",
      publicCredential: fixture.credential,
    };

    await service.submitPublicGuestMessage(command);
    await service.submitPublicGuestMessage(command);

    const messages = await getMessages(fixture.invitationId);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.message)).toEqual([
      "Duplicate by explicit submit",
      "Duplicate by explicit submit",
    ]);
    expect(messages[0]?.id).not.toBe(messages[1]?.id);
  });

  it("scopes writes to the invitation resolved from the credential and preserves RSVP.guestNote", async () => {
    const fixtureA = await createFixture({
      rsvpGuestNote: "Do not mirror this note.",
      rsvpStatus: RSVPStatus.ACCEPTED,
    });
    const fixtureB = await createFixture();

    await service.submitPublicGuestMessage({
      authorName: null,
      message: "Invitation A only",
      publicCredential: fixtureA.credential,
    });

    await expect(getMessages(fixtureA.invitationId)).resolves.toMatchObject([
      {
        invitationId: fixtureA.invitationId,
        message: "Invitation A only",
      },
    ]);
    await expect(getMessages(fixtureB.invitationId)).resolves.toHaveLength(0);
    await expect(
      prisma.rSVP.findUniqueOrThrow({
        where: { invitationId: fixtureA.invitationId },
        select: { guestNote: true },
      }),
    ).resolves.toEqual({
      guestNote: "Do not mirror this note.",
    });
  });
});
