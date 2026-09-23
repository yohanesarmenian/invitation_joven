import type {
  PublicInvitationResponseDto,
  PublicInviteeCategory,
  PublicRsvpStatus,
} from "./dto/public-invitation.dto.js";

export interface PublicInvitationEventProjection {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly startsAt: Date | null;
  readonly venueName: string | null;
  readonly address: string | null;
  readonly googleMapsUrl: string | null;
}

export interface PublicInvitationInviteeProjection {
  readonly id: string;
  readonly fullName: string;
  readonly category: PublicInviteeCategory;
}

export interface PublicInvitationRsvpProjection {
  readonly status: PublicRsvpStatus;
  readonly version: number;
}

export interface PublicInvitationProjection {
  readonly displayName: string;
  readonly greetingName: string | null;
  readonly rsvpDeadlineAt: Date | null;
  readonly events: readonly PublicInvitationEventProjection[];
  readonly invitees: readonly PublicInvitationInviteeProjection[];
  readonly allowPlusOne: boolean;
  readonly maxAdditionalChildren: number;
  readonly rsvp: PublicInvitationRsvpProjection | null;
}

function toIsoDate(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/**
 * Maps an already ordered retrieval projection to the public response contract.
 * Slice 3 owns ordering events and invitees by display order before this boundary.
 */
export function mapPublicInvitationResponse(
  projection: PublicInvitationProjection,
): PublicInvitationResponseDto {
  return {
    invitation: {
      displayName: projection.displayName,
      greetingName: projection.greetingName,
      rsvpDeadlineAt: toIsoDate(projection.rsvpDeadlineAt),
      events: projection.events.map((event) => ({
        id: event.id,
        slug: event.slug,
        name: event.name,
        startsAt: toIsoDate(event.startsAt),
        venueName: event.venueName,
        address: event.address,
        googleMapsUrl: event.googleMapsUrl,
      })),
      invitees: projection.invitees.map((invitee) => ({
        id: invitee.id,
        fullName: invitee.fullName,
        category: invitee.category,
      })),
      rules: {
        allowPlusOne: projection.allowPlusOne,
        maxAdditionalChildren: projection.maxAdditionalChildren,
      },
      rsvp:
        projection.rsvp === null
          ? null
          : {
              status: projection.rsvp.status,
              version: projection.rsvp.version,
            },
    },
  };
}
