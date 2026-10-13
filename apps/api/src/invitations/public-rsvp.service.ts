import { randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import {
  CheckinPassStatus,
  InvitationStatus,
  RSVPAttendeeType,
  RSVPStatus,
} from "../generated/prisma/client.js";
import { conflict, notFound } from "../auth/auth-errors.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CREDENTIAL_LOOKUP_HASH_PATTERN,
  CredentialService,
} from "../security/credential.service.js";
import type {
  CredentialLookupHash,
  DerivedCredential,
} from "../security/credential.types.js";
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

export type SubmitAdminRsvpOverrideCommand = {
  invitationId: string;
  submittedByAdminUserId: string;
  overrideReason: string;
  expectedVersion: number | null;
  status: PublicRsvpMutationStatus;
  eventSelections: PublicRsvpEventSelectionInput[];
  attendees: PublicRsvpAttendeeInput[];
  dietaryNotes?: string | null;
};

export type PublicRsvpMutationResult = {
  rsvp: {
    status: RSVPStatus;
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
    qrPayload: DerivedCredential;
  } | null;
};

export type PublicRsvpReadResult = {
  rsvp: PublicRsvpMutationResult["rsvp"] | null;
  checkinPass: PublicRsvpMutationResult["checkinPass"];
};

type RsvpLifecycleCommand = {
  expectedVersion: number | null;
  status: PublicRsvpMutationStatus;
  eventSelections: PublicRsvpEventSelectionInput[];
  attendees: PublicRsvpAttendeeInput[];
  dietaryNotes?: string | null;
};

type AdminRsvpAttribution = {
  submittedByAdminUserId: string;
  adminOverrideReason: string;
};

type RsvpAttributionPolicy =
  | { mode: "PUBLIC" }
  | { mode: "ADMIN"; attribution: AdminRsvpAttribution };

type RsvpLifecycleMutationResult = PublicRsvpMutationResult & {
  rsvpId: string;
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
  readonly hasCheckinRecord: boolean;
  readonly inviteeIds: ReadonlySet<string>;
  readonly rsvp: ExistingRsvpState;
  readonly activePass:
    | {
        credentialVersion: number;
        id: string;
        issuedAt: Date;
        status: CheckinPassStatus;
        tokenHash: string;
      }
    | null;
};

type ActiveCheckinPassForPublicResponse = {
  credentialVersion: number;
  id: string;
  issuedAt: Date;
  status: CheckinPassStatus;
  tokenHash: string;
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

class CheckinPassCredentialVerificationError extends Error {
  constructor() {
    super("Check-in pass credential verification failed.");
    this.name = "CheckinPassCredentialVerificationError";
  }
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

function credentialLookupHashesMatch(
  actual: CredentialLookupHash,
  expected: string,
): boolean {
  if (!CREDENTIAL_LOOKUP_HASH_PATTERN.test(expected)) {
    return false;
  }

  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function mapPublicCheckinPass(
  pass: ActiveCheckinPassForPublicResponse,
  credentialService: CredentialService,
): NonNullable<PublicRsvpMutationResult["checkinPass"]> {
  const qrPayload = credentialService.deriveCredential({
    namespace: "check-in",
    stableId: pass.id,
    version: pass.credentialVersion,
  });
  const tokenHash = credentialService.hashCredential(qrPayload);

  if (!credentialLookupHashesMatch(tokenHash, pass.tokenHash)) {
    throw new CheckinPassCredentialVerificationError();
  }

  return {
    issuedAt: pass.issuedAt.toISOString(),
    qrPayload,
    status: CheckinPassStatus.ACTIVE,
  };
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
  command: RsvpLifecycleCommand,
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

async function lockInvitationForAdminRsvp(
  tx: Prisma.TransactionClient,
  invitationId: string,
): Promise<LockedInvitationForRsvpRow> {
  const rows = await tx.$queryRaw<LockedInvitationForRsvpRow[]>`
    SELECT
      "id",
      "status"::text AS "status",
      "rsvp_deadline_at" AS "rsvpDeadlineAt",
      "allow_plus_one" AS "allowPlusOne",
      "max_additional_children" AS "maxAdditionalChildren"
    FROM "invitations"
    WHERE "id" = ${invitationId}::uuid
    FOR UPDATE
  `;
  const invitation = rows[0];

  if (!invitation) {
    notFound();
  }

  if (invitation.status !== InvitationStatus.ACTIVE) {
    conflict("Invitation is archived.");
  }

  return invitation;
}

async function readMutationState(
  tx: Prisma.TransactionClient,
  invitationId: string,
): Promise<InvitationMutationState> {
  const [rsvp, invitationEvents, invitees, checkinRecordCount] =
    await Promise.all([
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
            credentialVersion: true,
            id: true,
            issuedAt: true,
            status: true,
            tokenHash: true,
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
    tx.checkinRecord.count({
      where: { invitationId },
    }),
  ]);

  return {
    activePass: rsvp?.checkinPasses[0] ?? null,
    eligibleEventIds: new Set(
      invitationEvents.map((invitationEvent) => invitationEvent.eventId),
    ),
    hasCheckinRecord: checkinRecordCount > 0,
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

function toPublicMutationResult(
  result: RsvpLifecycleMutationResult,
): PublicRsvpMutationResult {
  return {
    checkinPass: result.checkinPass,
    rsvp: result.rsvp,
  };
}

async function readPublicRsvpState(
  tx: Prisma.TransactionClient,
  invitationId: string,
  credentialService: CredentialService,
): Promise<PublicRsvpReadResult> {
  const rsvp = await tx.rSVP.findUnique({
    where: { invitationId },
    select: {
      attendees: {
        orderBy: [{ createdAt: "asc" }, { attendeeType: "asc" }],
        select: {
          attendeeType: true,
          inviteeId: true,
          quantity: true,
        },
      },
      checkinPasses: {
        where: {
          status: CheckinPassStatus.ACTIVE,
        },
        orderBy: {
          issuedAt: "asc",
        },
        select: {
          credentialVersion: true,
          id: true,
          issuedAt: true,
          status: true,
          tokenHash: true,
        },
        take: 1,
      },
      dietaryNotes: true,
      eventSelections: {
        orderBy: [{ createdAt: "asc" }, { eventId: "asc" }],
        select: {
          attending: true,
          eventId: true,
          expectedAttendeeCount: true,
        },
      },
      status: true,
      version: true,
    },
  });

  if (rsvp === null) {
    return {
      checkinPass: null,
      rsvp: null,
    };
  }

  const activePass = rsvp.checkinPasses[0] ?? null;

  return {
    checkinPass:
      activePass === null
        ? null
        : mapPublicCheckinPass(activePass, credentialService),
    rsvp: {
      attendeeQuantityTotal: rsvp.attendees.reduce(
        (total, attendee) => total + attendee.quantity,
        0,
      ),
      attendees: rsvp.attendees.map((attendee) => ({
        inviteeId: attendee.inviteeId,
        quantity: attendee.quantity,
        type: attendee.attendeeType,
      })),
      dietaryNotes: rsvp.dietaryNotes,
      eventSelections: rsvp.eventSelections.map((selection) => ({
        attending: selection.attending,
        eventId: selection.eventId,
        expectedAttendeeCount: selection.expectedAttendeeCount,
      })),
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

    const result = await this.prisma.$transaction((tx) =>
      this.submitPublicRsvpInTransaction(tx, lookupHash, command),
    );

    return toPublicMutationResult(result);
  }

  async submitAdminRsvpOverride(
    command: SubmitAdminRsvpOverrideCommand,
  ): Promise<{ rsvpId: string }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const invitation = await lockInvitationForAdminRsvp(tx, command.invitationId);

      return this.submitRsvpForLockedInvitation(tx, invitation, command, {
        attributionPolicy: {
          attribution: {
            adminOverrideReason: command.overrideReason,
            submittedByAdminUserId: command.submittedByAdminUserId,
          },
          mode: "ADMIN",
        },
        enforceDeadline: false,
      });
    });

    return { rsvpId: result.rsvpId };
  }

  async retrievePublicRsvp(
    publicCredential: string,
  ): Promise<PublicRsvpReadResult> {
    const credential = validatePublicCredential(publicCredential);
    const lookupHash = this.credentialService.hashCredential(credential);

    return this.prisma.$transaction(async (tx) => {
      const invitation = await lockInvitationForRsvp(tx, lookupHash);

      return readPublicRsvpState(tx, invitation.id, this.credentialService);
    });
  }

  private async submitPublicRsvpInTransaction(
    tx: Prisma.TransactionClient,
    lookupHash: CredentialLookupHash,
    command: SubmitPublicRsvpCommand,
  ): Promise<RsvpLifecycleMutationResult> {
    const invitation = await lockInvitationForRsvp(tx, lookupHash);

    return this.submitRsvpForLockedInvitation(tx, invitation, command, {
      attributionPolicy: { mode: "PUBLIC" },
      enforceDeadline: true,
    });
  }

  private async submitRsvpForLockedInvitation(
    tx: Prisma.TransactionClient,
    invitation: LockedInvitationForRsvpRow,
    command: RsvpLifecycleCommand,
    policy: {
      attributionPolicy: RsvpAttributionPolicy;
      enforceDeadline: boolean;
    },
  ): Promise<RsvpLifecycleMutationResult> {
    const mutationTime = this.currentTime();

    if (
      policy.enforceDeadline &&
      invitation.rsvpDeadlineAt !== null &&
      mutationTime.getTime() > invitation.rsvpDeadlineAt.getTime()
    ) {
      throwPublicRsvpError("RSVP_DEADLINE_PASSED");
    }

    const state = await readMutationState(tx, invitation.id);
    validateExpectedVersion(command.expectedVersion, state.rsvp);

    if (state.hasCheckinRecord) {
      throwPublicRsvpError("RSVP_LOCKED_AFTER_CHECKIN");
    }

    if (command.status === RSVPStatus.DECLINED) {
      return this.applyDeclinedMutation(
        tx,
        invitation.id,
        state,
        mutationTime,
        policy.attributionPolicy,
      );
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
      policy.attributionPolicy,
    );
  }

  private async applyAcceptedMutation(
    tx: Prisma.TransactionClient,
    invitationId: string,
    state: InvitationMutationState,
    accepted: AcceptedValidation,
    mutationTime: Date,
    attributionPolicy: RsvpAttributionPolicy,
  ): Promise<RsvpLifecycleMutationResult> {
    const rsvp = await this.createOrUpdateRsvp(tx, {
      attributionPolicy,
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
      checkinPass: mapPublicCheckinPass(activePass, this.credentialService),
      rsvp: {
        attendeeQuantityTotal: accepted.attendeeQuantityTotal,
        attendees: accepted.attendees,
        dietaryNotes: accepted.dietaryNotes,
        eventSelections: accepted.eventSelections,
        status: RSVPStatus.ACCEPTED,
        version: rsvp.version,
      },
      rsvpId: rsvp.id,
    };
  }

  private async applyDeclinedMutation(
    tx: Prisma.TransactionClient,
    invitationId: string,
    state: InvitationMutationState,
    mutationTime: Date,
    attributionPolicy: RsvpAttributionPolicy,
  ): Promise<RsvpLifecycleMutationResult> {
    const rsvp = await this.createOrUpdateRsvp(tx, {
      attributionPolicy,
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
      rsvpId: rsvp.id,
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
      attributionPolicy: RsvpAttributionPolicy;
    },
  ): Promise<{ id: string; version: number }> {
    const adminAttributionData =
      input.attributionPolicy.mode === "PUBLIC"
        ? {
            adminOverrideReason: null,
            submittedByAdminUserId: null,
          }
        : {
            adminOverrideReason:
              input.attributionPolicy.attribution.adminOverrideReason,
            submittedByAdminUserId:
              input.attributionPolicy.attribution.submittedByAdminUserId,
          };

    if (input.state.rsvp === null) {
      return tx.rSVP.create({
        data: {
          ...adminAttributionData,
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
        ...adminAttributionData,
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
  ): Promise<ActiveCheckinPassForPublicResponse> {
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
        credentialVersion: true,
        id: true,
        issuedAt: true,
        status: true,
        tokenHash: true,
      },
    });
  }
}
