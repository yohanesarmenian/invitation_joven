export type PublicInviteeCategory = "ADULT" | "CHILD";

export type PublicRsvpStatus = "PENDING" | "ACCEPTED" | "DECLINED";

export interface PublicInvitationEventDto {
  id: string;
  slug: string;
  name: string;
  startsAt: string | null;
  venueName: string | null;
  address: string | null;
  googleMapsUrl: string | null;
}

export interface PublicInvitationInviteeDto {
  id: string;
  fullName: string;
  category: PublicInviteeCategory;
}

export interface PublicInvitationRulesDto {
  allowPlusOne: boolean;
  maxAdditionalChildren: number;
}

export interface PublicInvitationRsvpDto {
  status: PublicRsvpStatus;
  version: number;
}

export interface PublicInvitationDto {
  displayName: string;
  greetingName: string | null;
  rsvpDeadlineAt: string | null;
  events: PublicInvitationEventDto[];
  invitees: PublicInvitationInviteeDto[];
  rules: PublicInvitationRulesDto;
  rsvp: PublicInvitationRsvpDto | null;
}

export interface PublicInvitationResponseDto {
  invitation: PublicInvitationDto;
}
