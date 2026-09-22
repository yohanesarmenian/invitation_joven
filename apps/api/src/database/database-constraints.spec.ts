import { randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, afterAll } from "vitest";
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

afterAll(async () => {
  await prisma.$disconnect();
});

async function createInvitationGraph() {
  const suffix = randomUUID();
  const adminUser = await prisma.adminUser.create({
    data: {
      email: `owner-${suffix}@example.test`,
      passwordHash: `argon2id-placeholder-${suffix}`,
    },
  });
  const invitation = await prisma.invitation.create({
    data: {
      displayName: `Constraint Household ${suffix}`,
      publicTokenHash: `public-token-${suffix}`,
    },
  });
  const event = await prisma.event.create({
      data: {
        slug: `event-${suffix}`,
        name: "Constraint Test Event",
        displayOrder: randomInt(1, 2_000_000_000),
      },
  });
  const rsvp = await prisma.rSVP.create({
    data: {
      invitationId: invitation.id,
    },
  });

  return { adminUser, event, invitation, rsvp };
}

describe("database constraints", () => {
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
    const { adminUser, event, invitation, rsvp } = await createInvitationGraph();
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
