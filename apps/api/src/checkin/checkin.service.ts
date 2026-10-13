import { timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import {
  CheckinMethod,
  CheckinPassStatus,
  InvitationStatus,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CREDENTIAL_LOOKUP_HASH_PATTERN,
  DERIVED_CREDENTIAL_PATTERN,
  CredentialService,
} from "../security/credential.service.js";
import type {
  CredentialLookupHash,
  DerivedCredential,
} from "../security/credential.types.js";
import {
  InvitationNotAvailableError,
} from "../invitations/invitation-not-available.error.js";
import {
  CheckinDomainError,
  type CheckinErrorCode,
} from "./checkin.errors.js";
import type {
  AdminCheckinConfirmResponseDto,
  AdminCheckinEventsResponseDto,
  AdminCheckinSearchResponseDto,
  AdminCheckinValidateResponseDto,
  AdminPreviousCheckinDto,
} from "./dto/checkin.dto.js";

export type CheckinValidateCommand = {
  qrPayload: string;
  eventId: string;
};

export type CheckinConfirmCommand = CheckinValidateCommand & {
  attendeeCount: number;
};

export type CheckinManualConfirmCommand = {
  invitationId: string;
  eventId: string;
  attendeeCount: number;
};

export type CheckinSearchCommand = {
  query: string;
  eventId: string;
};

export type CheckinOperator = {
  id: string;
  email: string;
  role: "OWNER" | "CHECKIN_STAFF";
};

type CheckinTransaction = Prisma.TransactionClient;

type LockedInvitationRow = {
  id: string;
  status: string;
};

type ResolvedCheckinPass = {
  id: string;
  invitationId: string;
  rsvpId: string;
  tokenHash: string;
  credentialVersion: number;
  status: CheckinPassStatus;
  revokedAt: Date | null;
  expiresAt: Date | null;
};

type CheckinEligibility = {
  invitation: {
    id: string;
    displayName: string;
  };
  event: {
    id: string;
    name: string;
  };
  expectedAttendeeCount: number;
  previousCheckin: AdminPreviousCheckinDto | null;
};

function throwCheckinError(code: CheckinErrorCode): never {
  throw new CheckinDomainError(code);
}

function hashQrPayload(
  credentialService: CredentialService,
  qrPayload: string,
): CredentialLookupHash {
  if (!DERIVED_CREDENTIAL_PATTERN.test(qrPayload)) {
    throwCheckinError("QR_INVALID");
  }

  return credentialService.hashCredential(qrPayload as DerivedCredential);
}

function credentialLookupHashesMatch(
  left: string,
  right: string,
): left is CredentialLookupHash {
  if (
    !CREDENTIAL_LOOKUP_HASH_PATTERN.test(left) ||
    !CREDENTIAL_LOOKUP_HASH_PATTERN.test(right)
  ) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function mapPreviousCheckin(
  record: {
    attendeeCount: number;
    checkedInAt: Date;
    method: CheckinMethod;
    confirmedByAdminUser: CheckinOperator;
  } | null,
): AdminPreviousCheckinDto | null {
  if (record === null) {
    return null;
  }

  return {
    attendeeCount: record.attendeeCount,
    checkedInAt: record.checkedInAt.toISOString(),
    confirmedBy: record.confirmedByAdminUser,
    method: record.method,
  };
}

function mapValidateResponse(
  eligibility: CheckinEligibility,
): AdminCheckinValidateResponseDto {
  const alreadyCheckedIn = eligibility.previousCheckin !== null;

  return {
    alreadyCheckedIn,
    event: eligibility.event,
    expectedAttendeeCount: eligibility.expectedAttendeeCount,
    invitation: eligibility.invitation,
    previousCheckin: eligibility.previousCheckin,
    status: alreadyCheckedIn ? "ALREADY_CONFIRMED" : "VALID",
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

@Injectable()
export class CheckinService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService)
    private readonly credentialService: CredentialService,
  ) {}

  async listEvents(): Promise<AdminCheckinEventsResponseDto> {
    const events = await this.prisma.event.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        startsAt: true,
      },
      where: {
        isActive: true,
      },
    });

    return {
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        slug: event.slug,
        startsAt: event.startsAt?.toISOString() ?? null,
      })),
    };
  }

  async validateQr(
    command: CheckinValidateCommand,
  ): Promise<AdminCheckinValidateResponseDto> {
    const lookupHash = hashQrPayload(this.credentialService, command.qrPayload);

    return this.prisma.$transaction(async (tx) => {
      const pass = await this.resolveActiveCheckinPass(tx, lookupHash);
      this.assertPassCredentialMatches(pass, lookupHash);

      const eligibility = await this.readEligibility(tx, {
        eventId: command.eventId,
        invitationId: pass.invitationId,
      });

      return mapValidateResponse(eligibility);
    });
  }

  async confirmQr(
    command: CheckinConfirmCommand,
    operator: CheckinOperator,
  ): Promise<AdminCheckinConfirmResponseDto> {
    const lookupHash = hashQrPayload(this.credentialService, command.qrPayload);

    return this.prisma.$transaction(async (tx) => {
      const pass = await this.resolveActiveCheckinPass(tx, lookupHash);
      this.assertPassCredentialMatches(pass, lookupHash);
      await this.lockActiveInvitation(tx, pass.invitationId);
      const freshPass = await this.resolveActiveCheckinPass(tx, lookupHash);
      this.assertPassCredentialMatches(freshPass, lookupHash);

      return this.confirmForLockedInvitation(tx, {
        attendeeCount: command.attendeeCount,
        checkinPassId: freshPass.id,
        eventId: command.eventId,
        invitationId: freshPass.invitationId,
        method: CheckinMethod.QR,
        operator,
      });
    });
  }

  async search(
    command: CheckinSearchCommand,
  ): Promise<AdminCheckinSearchResponseDto> {
    const event = await this.prisma.event.findFirst({
      where: {
        id: command.eventId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (event === null) {
      throwCheckinError("EVENT_NOT_ALLOWED");
    }

    const invitations = await this.prisma.invitation.findMany({
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: {
        checkinRecords: {
          select: { id: true },
          take: 1,
          where: { eventId: command.eventId },
        },
        displayName: true,
        id: true,
        rsvp: {
          select: {
            eventSelections: {
              select: {
                expectedAttendeeCount: true,
              },
              take: 1,
              where: {
                attending: true,
                eventId: command.eventId,
                expectedAttendeeCount: { gte: 1 },
              },
            },
            status: true,
          },
        },
      },
      take: 10,
      where: {
        OR: [
          { displayName: { contains: command.query, mode: "insensitive" } },
          { greetingName: { contains: command.query, mode: "insensitive" } },
          {
            invitees: {
              some: {
                fullName: { contains: command.query, mode: "insensitive" },
              },
            },
          },
        ],
        invitationEvents: {
          some: { eventId: command.eventId },
        },
        rsvp: {
          is: {
            eventSelections: {
              some: {
                attending: true,
                eventId: command.eventId,
                expectedAttendeeCount: { gte: 1 },
              },
            },
            status: RSVPStatus.ACCEPTED,
          },
        },
        status: InvitationStatus.ACTIVE,
      },
    });

    return {
      items: invitations.flatMap((invitation) => {
        const selection = invitation.rsvp?.eventSelections[0] ?? null;

        if (selection === null) {
          return [];
        }

        return [
          {
            alreadyCheckedIn: invitation.checkinRecords.length > 0,
            event,
            expectedAttendeeCount: selection.expectedAttendeeCount,
            invitation: {
              displayName: invitation.displayName,
              id: invitation.id,
            },
          },
        ];
      }),
    };
  }

  async confirmManual(
    command: CheckinManualConfirmCommand,
    operator: CheckinOperator,
  ): Promise<AdminCheckinConfirmResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveInvitation(tx, command.invitationId);

      return this.confirmForLockedInvitation(tx, {
        attendeeCount: command.attendeeCount,
        checkinPassId: null,
        eventId: command.eventId,
        invitationId: command.invitationId,
        method: CheckinMethod.MANUAL,
        operator,
      });
    });
  }

  private async resolveActiveCheckinPass(
    tx: CheckinTransaction,
    lookupHash: CredentialLookupHash,
  ): Promise<ResolvedCheckinPass> {
    const pass = await tx.checkinPass.findUnique({
      select: {
        credentialVersion: true,
        expiresAt: true,
        id: true,
        invitationId: true,
        revokedAt: true,
        rsvpId: true,
        status: true,
        tokenHash: true,
      },
      where: {
        tokenHash: lookupHash,
      },
    });

    if (pass === null) {
      throwCheckinError("QR_INVALID");
    }

    if (
      pass.status !== CheckinPassStatus.ACTIVE ||
      pass.revokedAt !== null ||
      (pass.expiresAt !== null && pass.expiresAt.getTime() <= Date.now())
    ) {
      throwCheckinError("QR_REVOKED");
    }

    return pass;
  }

  private assertPassCredentialMatches(
    pass: ResolvedCheckinPass,
    lookupHash: CredentialLookupHash,
  ): void {
    const rederived = this.credentialService.deriveCredential({
      namespace: "check-in",
      stableId: pass.id,
      version: pass.credentialVersion,
    });
    const rederivedHash = this.credentialService.hashCredential(rederived);

    if (
      !credentialLookupHashesMatch(lookupHash, pass.tokenHash) ||
      !credentialLookupHashesMatch(rederivedHash, pass.tokenHash)
    ) {
      throwCheckinError("QR_INVALID");
    }
  }

  private async lockActiveInvitation(
    tx: CheckinTransaction,
    invitationId: string,
  ): Promise<LockedInvitationRow> {
    const rows = await tx.$queryRaw<LockedInvitationRow[]>`
      SELECT
        "id",
        "status"::text AS "status"
      FROM "invitations"
      WHERE "id" = ${invitationId}::uuid
      FOR UPDATE
    `;
    const invitation = rows[0];

    if (!invitation || invitation.status !== InvitationStatus.ACTIVE) {
      throw new InvitationNotAvailableError();
    }

    return invitation;
  }

  private async readEligibility(
    tx: CheckinTransaction,
    input: {
      invitationId: string;
      eventId: string;
    },
  ): Promise<CheckinEligibility> {
    const [invitation, event, invitationEvent, rsvp, existingCheckin] =
      await Promise.all([
        tx.invitation.findUnique({
          select: {
            displayName: true,
            id: true,
            status: true,
          },
          where: {
            id: input.invitationId,
          },
        }),
        tx.event.findUnique({
          select: {
            id: true,
            isActive: true,
            name: true,
          },
          where: {
            id: input.eventId,
          },
        }),
        tx.invitationEvent.findFirst({
          select: { id: true },
          where: {
            eventId: input.eventId,
            invitationId: input.invitationId,
          },
        }),
        tx.rSVP.findUnique({
          select: {
            eventSelections: {
              select: {
                attending: true,
                expectedAttendeeCount: true,
              },
              take: 1,
              where: {
                eventId: input.eventId,
              },
            },
            status: true,
          },
          where: {
            invitationId: input.invitationId,
          },
        }),
        tx.checkinRecord.findUnique({
          select: {
            attendeeCount: true,
            checkedInAt: true,
            confirmedByAdminUser: {
              select: {
                email: true,
                id: true,
                role: true,
              },
            },
            method: true,
          },
          where: {
            invitationId_eventId: {
              eventId: input.eventId,
              invitationId: input.invitationId,
            },
          },
        }),
      ]);

    if (invitation === null || invitation.status !== InvitationStatus.ACTIVE) {
      throw new InvitationNotAvailableError();
    }

    if (event === null || !event.isActive || invitationEvent === null) {
      throwCheckinError("EVENT_NOT_ALLOWED");
    }

    const selection = rsvp?.eventSelections[0] ?? null;

    if (
      rsvp === null ||
      rsvp.status !== RSVPStatus.ACCEPTED ||
      selection === null ||
      !selection.attending ||
      selection.expectedAttendeeCount < 1
    ) {
      throwCheckinError("EVENT_NOT_SELECTED");
    }

    return {
      event: {
        id: event.id,
        name: event.name,
      },
      expectedAttendeeCount: selection.expectedAttendeeCount,
      invitation: {
        displayName: invitation.displayName,
        id: invitation.id,
      },
      previousCheckin: mapPreviousCheckin(existingCheckin),
    };
  }

  private async confirmForLockedInvitation(
    tx: CheckinTransaction,
    input: {
      invitationId: string;
      eventId: string;
      attendeeCount: number;
      checkinPassId: string | null;
      method: CheckinMethod;
      operator: CheckinOperator;
    },
  ): Promise<AdminCheckinConfirmResponseDto> {
    const eligibility = await this.readEligibility(tx, input);

    if (eligibility.previousCheckin !== null) {
      throwCheckinError("CHECKIN_ALREADY_CONFIRMED");
    }

    if (
      input.attendeeCount < 1 ||
      input.attendeeCount > eligibility.expectedAttendeeCount
    ) {
      throwCheckinError("INVALID_ATTENDEE_COUNT");
    }

    try {
      const checkinRecord = await tx.checkinRecord.create({
        data: {
          attendeeCount: input.attendeeCount,
          checkinPassId: input.checkinPassId,
          confirmedByAdminUserId: input.operator.id,
          eventId: input.eventId,
          invitationId: input.invitationId,
          method: input.method,
        },
        select: {
          attendeeCount: true,
          checkedInAt: true,
          id: true,
          method: true,
        },
      });

      return {
        checkinRecord: {
          attendeeCount: checkinRecord.attendeeCount,
          checkedInAt: checkinRecord.checkedInAt.toISOString(),
          confirmedBy: input.operator,
          id: checkinRecord.id,
          method: checkinRecord.method,
        },
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throwCheckinError("CHECKIN_ALREADY_CONFIRMED");
      }

      throw error;
    }
  }
}
