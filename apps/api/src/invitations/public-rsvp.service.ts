import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import {
  CheckinPassStatus,
  InvitationStatus,
  RSVPAttendeeType,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { CredentialService } from "../security/credential.service.js";
import type { CredentialLookupHash } from "../security/credential.types.js";
import { InvitationNotAvailableError } from "./invitation-not-available.error.js";
import { validatePublicCredential } from "./public-invitation.service.js";
import {
  PublicRsvpDomainError,
  type PublicRsvpErrorCode,
} from "./public-rsvp.errors.js";

export const PUBLIC_RSVP_CLOCK = Symbol("PUBLIC_RSVP_CLOCK");
export type PublicRsvpClock = () => Date;

const CHECKIN_PASS_CREDENTIAL_VERSION = 1;
const DIETARY_NOTES_MAX_LENGTH = 500;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type PublicRsvpMutationStatus =
  | typeof RSVPStatus.ACCEPTED
  | typeof RSVPStatus.DECLINED;

export type PublicRsvpAttendeeInput = {
  type: RSVPAttendeeType;
  inviteeId?: string | null;
  quantity: number;
};

export type PublicRsvpEventSelectionInput = {
  eventId: string;
  attending: boolean;
  expectedAttendeeCount: number;
};

export type SubmitPublicRsvpCommand = {
  publicCredential: string;
  expectedVersion: number | null;
  status: PublicRsvpMutationStatus;
  eventSelections: PublicRsvpEventSelectionInput[];
  attendees: PublicRsvpAttendeeInput[];
  dietaryNotes?: string | null;
};

export type PublicRsvpMutationResult = {
  rsvp: {
    status: PublicRsvpMutationStatus;
    version: number;
    dietaryNotes: string | null;
    attendeeQuantityTotal: number;
    eventSelections: Array<{
      eventId: string;
      attending: boolean;
      expectedAttendeeCount: number;
    }>;
    attendees: Array<{
      type: RSVPAttendeeType;
      inviteeId: string | null;
      quantity: number;
    }>;
  };
  checkinPass: {
    status: typeof CheckinPassStatus.ACTIVE;
    issuedAt: string;
  } | null;
};

interface LockedInvitationForRsvpRow {
  id: string;
  status: string;
  rsvpDeadlineAt: Date | null;
  allowPlusOne: boolean;
  maxAdditionalChildren: number;
}

type ExistingRsvpState = {
  id: string;
  status: RSVPStatus;
  version: number;
} | null;

type InvitationMutationState = {
  readonly eligibleEventIds: ReadonlySet<string>;
  readonly inviteeIds: ReadonlySet<string>;
  readonly rsvp: ExistingRsvpState;
  readonly activePass:
    | {
        id: string;
        issuedAt: Date;
      }
    | null;
};

type AcceptedValidation = {
  dietaryNotes: string | null;
  attendeeQuantityTotal: number;
  eventSelections: PublicRsvpEventSelectionInput[];
  attendees: Array<{
    type: RSVPAttendeeType;
    inviteeId: string | null;
    quantity: number;
  }>;
};

function throwPublicRsvpError(code: PublicRsvpErrorCode): never {
  throw new PublicRsvpDomainError(code);
}

function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function assertSafePositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
  }
}

function assertNoInviteeId(inviteeId: string | null | undefined): void {
  if (inviteeId !== null && inviteeId !== undefined) {
    throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
  }
}

function normalizeDietaryNotes(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";

  if (normalized.length === 0) {
    return null;
  }

  if (normalized.length > DIETARY_NOTES_MAX_LENGTH) {
    throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
  }

  return normalized;
}

function validateExpectedVersion(
  expectedVersion: number | null,
  rsvp: ExistingRsvpState,
): void {
  if (rsvp === null) {
    if (expectedVersion !== null) {
      throwPublicRsvpError("RSVP_VERSION_CONFLICT");
    }

    return;
  }

  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion !== rsvp.version
  ) {
    throwPublicRsvpError("RSVP_VERSION_CONFLICT");
  }
}

function validateAcceptedInput(
  command: SubmitPublicRsvpCommand,
  invitation: LockedInvitationForRsvpRow,
  state: InvitationMutationState,
): AcceptedValidation {
  const dietaryNotes = normalizeDietaryNotes(command.dietaryNotes);
  const attendees = validateAttendees(command.attendees, invitation, state);
  const attendeeQuantityTotal = attendees.reduce(
    (total, attendee) => total + attendee.quantity,
    0,
  );
  const eventSelections = validateEventSelections(
    command.eventSelections,
    state,
    attendeeQuantityTotal,
  );

  return {
    attendeeQuantityTotal,
    attendees,
    dietaryNotes,
    eventSelections,
  };
}

function validateAttendees(
  attendees: readonly PublicRsvpAttendeeInput[],
  invitation: LockedInvitationForRsvpRow,
  state: InvitationMutationState,
): AcceptedValidation["attendees"] {
  const namedInviteeIds = new Set<string>();
  let hasPlusOne = false;
  let additionalChildrenQuantity = 0;

  return attendees.map((attendee) => {
    assertSafePositiveInteger(attendee.quantity);

    switch (attendee.type) {
      case RSVPAttendeeType.NAMED_INVITEE: {
        if (
          !isUuid(attendee.inviteeId) ||
          attendee.quantity !== 1 ||
          !state.inviteeIds.has(attendee.inviteeId) ||
          namedInviteeIds.has(attendee.inviteeId)
        ) {
          throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
        }

        namedInviteeIds.add(attendee.inviteeId);

        return {
          inviteeId: attendee.inviteeId,
          quantity: attendee.quantity,
          type: attendee.type,
        };
      }

      case RSVPAttendeeType.PLUS_ONE:
        assertNoInviteeId(attendee.inviteeId);

        if (!invitation.allowPlusOne) {
          throwPublicRsvpError("PLUS_ONE_NOT_ALLOWED");
        }

        if (attendee.quantity !== 1 || hasPlusOne) {
          throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
        }

        hasPlusOne = true;

        return {
          inviteeId: null,
          quantity: attendee.quantity,
          type: attendee.type,
        };

      case RSVPAttendeeType.ADDITIONAL_CHILD:
        assertNoInviteeId(attendee.inviteeId);
        additionalChildrenQuantity += attendee.quantity;

        if (additionalChildrenQuantity > invitation.maxAdditionalChildren) {
          throwPublicRsvpError("ADDITIONAL_CHILD_LIMIT_EXCEEDED");
        }

        return {
          inviteeId: null,
          quantity: attendee.quantity,
          type: attendee.type,
        };

      default:
        throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
    }
  });
}

function validateEventSelections(
  eventSelections: readonly PublicRsvpEventSelectionInput[],
  state: InvitationMutationState,
  attendeeQuantityTotal: number,
): PublicRsvpEventSelectionInput[] {
  const eventIds = new Set<string>();
  let attendingEventCount = 0;

  const validated = eventSelections.map((selection) => {
    if (
      !isUuid(selection.eventId) ||
      eventIds.has(selection.eventId) ||
      !state.eligibleEventIds.has(selection.eventId)
    ) {
      throwPublicRsvpError("EVENT_NOT_ALLOWED");
    }

    eventIds.add(selection.eventId);

    if (!Number.isSafeInteger(selection.expectedAttendeeCount)) {
      throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
    }

    if (!selection.attending) {
      if (selection.expectedAttendeeCount !== 0) {
        throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
      }

      return {
        attending: false,
        eventId: selection.eventId,
        expectedAttendeeCount: 0,
      };
    }

    attendingEventCount += 1;

    if (
      selection.expectedAttendeeCount < 1 ||
      selection.expectedAttendeeCount > attendeeQuantityTotal
    ) {
      throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
    }

    return {
      attending: true,
      eventId: selection.eventId,
      expectedAttendeeCount: selection.expectedAttendeeCount,
    };
  });

  if (attendingEventCount === 0) {
    throwPublicRsvpError("EVENT_NOT_SELECTED");
  }

  return validated;
}

async function lockInvitationForRsvp(
  tx: Prisma.TransactionClient,
  lookupHash: CredentialLookupHash,
): Promise<LockedInvitationForRsvpRow> {
  const rows = await tx.$queryRaw<LockedInvitationForRsvpRow[]>`
    SELECT
      "id",
      "status"::text AS "status",
      "rsvp_deadline_at" AS "rsvpDeadlineAt",
      "allow_plus_one" AS "allowPlusOne",
      "max_additional_children" AS "maxAdditionalChildren"
    FROM "invitations"
    WHERE "public_token_hash" = ${lookupHash}
    FOR UPDATE
  `;
  const invitation = rows[0];

  if (!invitation || invitation.status !== InvitationStatus.ACTIVE) {
    throw new InvitationNotAvailableError();
  }

  return invitation;
}

async function readMutationState(
  tx: Prisma.TransactionClient,
  invitationId: string,
): Promise<InvitationMutationState> {
  const [rsvp, invitationEvents, invitees] = await Promise.all([
    tx.rSVP.findUnique({
      where: { invitationId },
      select: {
        id: true,
        status: true,
        version: true,
        checkinPasses: {
          where: {
            status: CheckinPassStatus.ACTIVE,
          },
          select: {
            id: true,
            issuedAt: true,
          },
          take: 1,
        },
      },
    }),
    tx.invitationEvent.findMany({
      where: { invitationId },
      select: { eventId: true },
    }),
    tx.invitee.findMany({
      where: { invitationId },
      select: { id: true },
    }),
  ]);

  return {
    activePass: rsvp?.checkinPasses[0] ?? null,
    eligibleEventIds: new Set(
      invitationEvents.map((invitationEvent) => invitationEvent.eventId),
    ),
    inviteeIds: new Set(invitees.map((invitee) => invitee.id)),
    rsvp:
      rsvp === null
        ? null
        : {
            id: rsvp.id,
            status: rsvp.status,
            version: rsvp.version,
          },
  };
}

@Injectable()
export class PublicRsvpService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService)
    private readonly credentialService: CredentialService,
    @Optional()
    @Inject(PUBLIC_RSVP_CLOCK)
    private readonly currentTime: PublicRsvpClock = () => new Date(),
  ) {}

  async submitPublicRsvp(
    command: SubmitPublicRsvpCommand,
  ): Promise<PublicRsvpMutationResult> {
    const credential = validatePublicCredential(command.publicCredential);
    const lookupHash = this.credentialService.hashCredential(credential);

    return this.prisma.$transaction((tx) =>
      this.submitPublicRsvpInTransaction(tx, lookupHash, command),
    );
  }

  private async submitPublicRsvpInTransaction(
    tx: Prisma.TransactionClient,
    lookupHash: CredentialLookupHash,
    command: SubmitPublicRsvpCommand,
  ): Promise<PublicRsvpMutationResult> {
    const invitation = await lockInvitationForRsvp(tx, lookupHash);
    const mutationTime = this.currentTime();

    if (
      invitation.rsvpDeadlineAt !== null &&
      mutationTime.getTime() > invitation.rsvpDeadlineAt.getTime()
    ) {
      throwPublicRsvpError("RSVP_DEADLINE_PASSED");
    }

    const state = await readMutationState(tx, invitation.id);
    validateExpectedVersion(command.expectedVersion, state.rsvp);

    if (command.status === RSVPStatus.DECLINED) {
      return this.applyDeclinedMutation(tx, invitation.id, state, mutationTime);
    }

    if (command.status !== RSVPStatus.ACCEPTED) {
      throwPublicRsvpError("RSVP_ATTENDEE_INVALID");
    }

    const accepted = validateAcceptedInput(command, invitation, state);
    return this.applyAcceptedMutation(
      tx,
      invitation.id,
      state,
      accepted,
      mutationTime,
    );
  }

  private async applyAcceptedMutation(
    tx: Prisma.TransactionClient,
    invitationId: string,
    state: InvitationMutationState,
    accepted: AcceptedValidation,
    mutationTime: Date,
  ): Promise<PublicRsvpMutationResult> {
    const rsvp = await this.createOrUpdateRsvp(tx, {
      dietaryNotes: accepted.dietaryNotes,
      invitationId,
      mutationTime,
      state,
      status: RSVPStatus.ACCEPTED,
    });

    await Promise.all([
      tx.rSVPEventSelection.deleteMany({ where: { rsvpId: rsvp.id } }),
      tx.rSVPAttendee.deleteMany({ where: { rsvpId: rsvp.id } }),
    ]);

    if (accepted.eventSelections.length > 0) {
      await tx.rSVPEventSelection.createMany({
        data: accepted.eventSelections.map((selection) => ({
          attending: selection.attending,
          eventId: selection.eventId,
          expectedAttendeeCount: selection.expectedAttendeeCount,
          rsvpId: rsvp.id,
        })),
      });
    }

    if (accepted.attendees.length > 0) {
      await tx.rSVPAttendee.createMany({
        data: accepted.attendees.map((attendee) => ({
          attendeeType: attendee.type,
          inviteeId: attendee.inviteeId,
          quantity: attendee.quantity,
          rsvpId: rsvp.id,
        })),
      });
    }

    const activePass =
      state.activePass ??
      (await this.issueActiveCheckinPass(tx, invitationId, rsvp.id));

    return {
      checkinPass: {
        issuedAt: activePass.issuedAt.toISOString(),
        status: CheckinPassStatus.ACTIVE,
      },
      rsvp: {
        attendeeQuantityTotal: accepted.attendeeQuantityTotal,
        attendees: accepted.attendees,
        dietaryNotes: accepted.dietaryNotes,
        eventSelections: accepted.eventSelections,
        status: RSVPStatus.ACCEPTED,
        version: rsvp.version,
      },
    };
  }

  private async applyDeclinedMutation(
    tx: Prisma.TransactionClient,
    invitationId: string,
    state: InvitationMutationState,
    mutationTime: Date,
  ): Promise<PublicRsvpMutationResult> {
    const rsvp = await this.createOrUpdateRsvp(tx, {
      dietaryNotes: null,
      invitationId,
      mutationTime,
      state,
      status: RSVPStatus.DECLINED,
    });

    await Promise.all([
      tx.rSVPEventSelection.deleteMany({ where: { rsvpId: rsvp.id } }),
      tx.rSVPAttendee.deleteMany({ where: { rsvpId: rsvp.id } }),
      tx.checkinPass.updateMany({
        data: {
          revokedAt: mutationTime,
          revocationReason: "RSVP_DECLINED",
          status: CheckinPassStatus.REVOKED,
        },
        where: {
          invitationId,
          status: CheckinPassStatus.ACTIVE,
        },
      }),
    ]);

    return {
      checkinPass: null,
      rsvp: {
        attendeeQuantityTotal: 0,
        attendees: [],
        dietaryNotes: null,
        eventSelections: [],
        status: RSVPStatus.DECLINED,
        version: rsvp.version,
      },
    };
  }

  private async createOrUpdateRsvp(
    tx: Prisma.TransactionClient,
    input: {
      dietaryNotes: string | null;
      invitationId: string;
      mutationTime: Date;
      state: InvitationMutationState;
      status: PublicRsvpMutationStatus;
    },
  ): Promise<{ id: string; version: number }> {
    if (input.state.rsvp === null) {
      return tx.rSVP.create({
        data: {
          dietaryNotes: input.dietaryNotes,
          invitationId: input.invitationId,
          lastUpdatedAt: input.mutationTime,
          status: input.status,
          submittedAt: input.mutationTime,
          version: 1,
        },
        select: {
          id: true,
          version: true,
        },
      });
    }

    return tx.rSVP.update({
      data: {
        dietaryNotes: input.dietaryNotes,
        lastUpdatedAt: input.mutationTime,
        status: input.status,
        version: input.state.rsvp.version + 1,
      },
      where: {
        id: input.state.rsvp.id,
      },
      select: {
        id: true,
        version: true,
      },
    });
  }

  private async issueActiveCheckinPass(
    tx: Prisma.TransactionClient,
    invitationId: string,
    rsvpId: string,
  ): Promise<{ id: string; issuedAt: Date }> {
    const id = randomUUID();
    const credential = this.credentialService.deriveCredential({
      namespace: "check-in",
      stableId: id,
      version: CHECKIN_PASS_CREDENTIAL_VERSION,
    });
    const tokenHash = this.credentialService.hashCredential(credential);

    return tx.checkinPass.create({
      data: {
        credentialVersion: CHECKIN_PASS_CREDENTIAL_VERSION,
        id,
        invitationId,
        rsvpId,
        status: CheckinPassStatus.ACTIVE,
        tokenHash,
      },
      select: {
        id: true,
        issuedAt: true,
      },
    });
  }
}
