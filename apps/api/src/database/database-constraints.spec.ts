import { randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, afterAll, afterEach } from "vitest";
import {
  CheckinMethod,
  CheckinPassStatus,
  InviteeCategory,
  PrismaClient,
  RSVPAttendeeType,
} from "../generated/prisma/client.js";
import { getDatabaseUrl } from "./database-url.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg(getDatabaseUrl()),
});
const invitationIds: string[] = [];
const eventIds: string[] = [];
const adminUserIds: string[] = [];

async function cleanupFixtures() {
  await prisma.$transaction(async (tx) => {
    const invitations = { invitationId: { in: invitationIds } };
    await tx.checkinRecord.deleteMany({ where: invitations });
    await tx.checkinPass.deleteMany({ where: invitations });
    await tx.rSVP.deleteMany({ where: invitations });
    await tx.invitee.deleteMany({ where: invitations });
    await tx.invitation.deleteMany({ where: { id: { in: invitationIds } } });
    await tx.event.deleteMany({ where: { id: { in: eventIds } } });
    await tx.adminUser.deleteMany({ where: { id: { in: adminUserIds } } });
  });
  invitationIds.length = 0;
  eventIds.length = 0;
  adminUserIds.length = 0;
}

afterEach(cleanupFixtures);

afterAll(async () => {
  try {
    await cleanupFixtures();
  } finally {
    await prisma.$disconnect();
  }
});

async function createInvitationGraph() {
  const suffix = randomUUID();
  const adminUser = await prisma.adminUser.create({
    data: {
      email: `owner-${suffix}@example.test`,
      passwordHash: `argon2id-placeholder-${suffix}`,
    },
  });
  adminUserIds.push(adminUser.id);
  const invitation = await prisma.invitation.create({
    data: {
      displayName: `Constraint Household ${suffix}`,
      publicTokenHash: `public-token-${suffix}`,
    },
  });
  invitationIds.push(invitation.id);
  const event = await prisma.event.create({
    data: {
      slug: `event-${suffix}`,
      name: "Constraint Test Event",
      displayOrder: randomInt(1, 2_000_000_000),
    },
  });
  eventIds.push(event.id);
  const rsvp = await prisma.rSVP.create({
    data: {
      invitationId: invitation.id,
    },
  });

  return { adminUser, event, invitation, rsvp };
}

describe("database constraints", () => {
  it("cleans owned fixture rows without removing an unrelated event", async () => {
    const suffix = randomUUID();
    const witness = await prisma.event.create({
      data: {
        name: "Cleanup isolation witness",
        slug: `witness-${suffix}`,
        displayOrder: randomInt(1, 2_000_000_000),
      },
    });
    try {
      const owned = await createInvitationGraph();
      await cleanupFixtures();
      expect(await prisma.event.count({ where: { id: owned.event.id } })).toBe(
        0,
      );
      expect(
        await prisma.invitation.count({ where: { id: owned.invitation.id } }),
      ).toBe(0);
      expect(await prisma.rSVP.count({ where: { id: owned.rsvp.id } })).toBe(0);
      expect(
        await prisma.adminUser.count({ where: { id: owned.adminUser.id } }),
      ).toBe(0);
      expect(await prisma.event.count({ where: { id: witness.id } })).toBe(1);
    } finally {
      await prisma.event.deleteMany({ where: { id: witness.id } });
    }
  });

  it("rejects a second active CheckinPass for one Invitation", async () => {
    const { invitation, rsvp } = await createInvitationGraph();

    await prisma.checkinPass.create({
      data: {
        invitationId: invitation.id,
        rsvpId: rsvp.id,
        tokenHash: `checkin-token-${randomUUID()}`,
      },
    });

    await expect(
      prisma.checkinPass.create({
        data: {
          invitationId: invitation.id,
          rsvpId: rsvp.id,
          tokenHash: `checkin-token-${randomUUID()}`,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate CheckinRecord for one Invitation and Event", async () => {
    const { adminUser, event, invitation, rsvp } =
      await createInvitationGraph();
    const pass = await prisma.checkinPass.create({
      data: {
        invitationId: invitation.id,
        rsvpId: rsvp.id,
        tokenHash: `checkin-token-${randomUUID()}`,
      },
    });

    await prisma.checkinRecord.create({
      data: {
        attendeeCount: 1,
        checkinPassId: pass.id,
        confirmedByAdminUserId: adminUser.id,
        eventId: event.id,
        invitationId: invitation.id,
        method: CheckinMethod.QR,
      },
    });

    await expect(
      prisma.checkinRecord.create({
        data: {
          attendeeCount: 1,
          checkinPassId: pass.id,
          confirmedByAdminUserId: adminUser.id,
          eventId: event.id,
          invitationId: invitation.id,
          method: CheckinMethod.QR,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate named Invitee within one RSVP", async () => {
    const { invitation, rsvp } = await createInvitationGraph();
    const invitee = await prisma.invitee.create({
      data: {
        category: InviteeCategory.ADULT,
        displayOrder: 0,
        fullName: "Named Guest",
        invitationId: invitation.id,
      },
    });

    await prisma.rSVPAttendee.create({
      data: {
        attendeeType: RSVPAttendeeType.NAMED_INVITEE,
        inviteeId: invitee.id,
        quantity: 1,
        rsvpId: rsvp.id,
      },
    });

    await expect(
      prisma.rSVPAttendee.create({
        data: {
          attendeeType: RSVPAttendeeType.NAMED_INVITEE,
          inviteeId: invitee.id,
          quantity: 1,
          rsvpId: rsvp.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a second PLUS_ONE attendee row", async () => {
    const { rsvp } = await createInvitationGraph();

    await prisma.rSVPAttendee.create({
      data: {
        attendeeType: RSVPAttendeeType.PLUS_ONE,
        quantity: 1,
        rsvpId: rsvp.id,
      },
    });

    await expect(
      prisma.rSVPAttendee.create({
        data: {
          attendeeType: RSVPAttendeeType.PLUS_ONE,
          quantity: 1,
          rsvpId: rsvp.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects invalid RSVPAttendee type/reference/quantity combinations", async () => {
    const { rsvp } = await createInvitationGraph();

    await expect(
      prisma.rSVPAttendee.create({
        data: {
          attendeeType: RSVPAttendeeType.NAMED_INVITEE,
          quantity: 1,
          rsvpId: rsvp.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.rSVPAttendee.create({
        data: {
          attendeeType: RSVPAttendeeType.PLUS_ONE,
          quantity: 2,
          rsvpId: rsvp.id,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.rSVPAttendee.create({
        data: {
          attendeeType: RSVPAttendeeType.ADDITIONAL_CHILD,
          quantity: 0,
          rsvpId: rsvp.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects QR CheckinRecord rows without a CheckinPass", async () => {
    const { adminUser, event, invitation } = await createInvitationGraph();

    await expect(
      prisma.checkinRecord.create({
        data: {
          attendeeCount: 1,
          confirmedByAdminUserId: adminUser.id,
          eventId: event.id,
          invitationId: invitation.id,
          method: CheckinMethod.QR,
        },
      }),
    ).rejects.toThrow();
  });

  it("allows historical non-active CheckinPass rows for one Invitation", async () => {
    const { invitation, rsvp } = await createInvitationGraph();

    await prisma.checkinPass.create({
      data: {
        invitationId: invitation.id,
        revokedAt: new Date(),
        rsvpId: rsvp.id,
        status: CheckinPassStatus.REVOKED,
        tokenHash: `checkin-token-${randomUUID()}`,
      },
    });

    await prisma.checkinPass.create({
      data: {
        invitationId: invitation.id,
        revokedAt: new Date(),
        rsvpId: rsvp.id,
        status: CheckinPassStatus.REVOKED,
        tokenHash: `checkin-token-${randomUUID()}`,
      },
    });
  });
});
