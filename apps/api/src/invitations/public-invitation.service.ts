import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { InvitationStatus } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { CredentialService } from "../security/credential.service.js";
import type {
  CredentialLookupHash,
  DerivedCredential,
} from "../security/credential.types.js";
import type { PublicInvitationResponseDto } from "./dto/public-invitation.dto.js";
import { InvitationNotAvailableError } from "./invitation-not-available.error.js";
import {
  mapPublicInvitationResponse,
  type PublicInvitationProjection,
} from "./public-invitation.mapper.js";

export const PUBLIC_CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface LockedInvitationRow {
  id: string;
  status: string;
}

interface OpenAggregateRow {
  firstOpenedAt: Date;
  lastOpenedAt: Date;
  openCount: number;
}

export function validatePublicCredential(
  publicCredential: string,
): DerivedCredential {
  if (!PUBLIC_CREDENTIAL_PATTERN.test(publicCredential)) {
    throw new InvitationNotAvailableError();
  }

  return publicCredential as DerivedCredential;
}

export async function readPublicInvitationProjectionForLookupHash(
  tx: Prisma.TransactionClient,
  lookupHash: CredentialLookupHash,
): Promise<PublicInvitationProjection> {
  const lockedRows = await tx.$queryRaw<LockedInvitationRow[]>`
    SELECT "id", "status"::text AS "status"
    FROM "invitations"
    WHERE "public_token_hash" = ${lookupHash}
    FOR UPDATE
  `;

  const lockedInvitation = lockedRows[0];

  if (
    !lockedInvitation ||
    lockedInvitation.status !== InvitationStatus.ACTIVE
  ) {
    throw new InvitationNotAvailableError();
  }

  const openRows = await tx.$queryRaw<OpenAggregateRow[]>`
    UPDATE "invitations"
    SET
      "first_opened_at" = COALESCE("first_opened_at", CURRENT_TIMESTAMP),
      "last_opened_at" = CURRENT_TIMESTAMP,
      "open_count" = "open_count" + 1,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${lockedInvitation.id}::uuid
      AND "status" = 'ACTIVE'
    RETURNING
      "first_opened_at" AS "firstOpenedAt",
      "last_opened_at" AS "lastOpenedAt",
      "open_count" AS "openCount"
  `;

  if (openRows.length !== 1) {
    throw new Error("Failed to record public invitation open.");
  }

  const invitation = await tx.invitation.findUnique({
    where: {
      id: lockedInvitation.id,
    },
    select: {
      displayName: true,
      greetingName: true,
      rsvpDeadlineAt: true,
      allowPlusOne: true,
      maxAdditionalChildren: true,
    },
  });

  if (!invitation) {
    throw new Error("Failed to read public invitation projection.");
  }

  const events = await tx.event.findMany({
    where: {
      invitationEvents: {
        some: {
          invitationId: lockedInvitation.id,
        },
      },
    },
    orderBy: {
      displayOrder: "asc",
    },
    select: {
      id: true,
      slug: true,
      name: true,
      startsAt: true,
      endsAt: true,
      venueName: true,
      address: true,
      googleMapsUrl: true,
    },
  });

  const invitees = await tx.invitee.findMany({
    where: {
      invitationId: lockedInvitation.id,
    },
    orderBy: {
      displayOrder: "asc",
    },
    select: {
      id: true,
      fullName: true,
      category: true,
    },
  });

  const rsvp = await tx.rSVP.findUnique({
    where: {
      invitationId: lockedInvitation.id,
    },
    select: {
      status: true,
      version: true,
    },
  });

  return {
    displayName: invitation.displayName,
    greetingName: invitation.greetingName,
    rsvpDeadlineAt: invitation.rsvpDeadlineAt,
    events,
    invitees,
    allowPlusOne: invitation.allowPlusOne,
    maxAdditionalChildren: invitation.maxAdditionalChildren,
    rsvp,
  };
}

@Injectable()
export class PublicInvitationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CredentialService)
    private readonly credentialHasher: CredentialService,
  ) {}

  async retrievePublicInvitation(
    publicCredential: string,
  ): Promise<PublicInvitationResponseDto> {
    const credential = validatePublicCredential(publicCredential);
    const lookupHash = this.credentialHasher.hashCredential(credential);
    const projection = await this.prisma.$transaction((tx) =>
      readPublicInvitationProjectionForLookupHash(tx, lookupHash),
    );

    return mapPublicInvitationResponse(projection);
  }
}
