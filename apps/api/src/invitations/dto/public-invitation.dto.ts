import { ApiProperty } from "@nestjs/swagger";

export const publicInviteeCategories = ["ADULT", "CHILD"] as const;
export type PublicInviteeCategory = (typeof publicInviteeCategories)[number];

export const publicRsvpStatuses = ["PENDING", "ACCEPTED", "DECLINED"] as const;
export type PublicRsvpStatus = (typeof publicRsvpStatuses)[number];

export class PublicInvitationEventDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  slug: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({
    format: "date-time",
    nullable: true,
    type: String,
  })
  startsAt: string | null;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  endsAt: string | null;

  @ApiProperty({ nullable: true, type: String })
  venueName: string | null;

  @ApiProperty({ nullable: true, type: String })
  address: string | null;

  @ApiProperty({ nullable: true, type: String })
  googleMapsUrl: string | null;
}

export class PublicInvitationInviteeDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  fullName: string;

  @ApiProperty({ enum: publicInviteeCategories, type: String })
  category: PublicInviteeCategory;
}

export class PublicInvitationRulesDto {
  @ApiProperty({ type: Boolean })
  allowPlusOne: boolean;

  @ApiProperty({ minimum: 0, type: Number })
  maxAdditionalChildren: number;
}

export class PublicInvitationRsvpDto {
  @ApiProperty({ enum: publicRsvpStatuses, type: String })
  status: PublicRsvpStatus;

  @ApiProperty({ minimum: 1, type: Number })
  version: number;
}

export class PublicInvitationDto {
  @ApiProperty({ type: String })
  displayName: string;

  @ApiProperty({ nullable: true, type: String })
  greetingName: string | null;

  @ApiProperty({
    format: "date-time",
    nullable: true,
    type: String,
  })
  rsvpDeadlineAt: string | null;

  @ApiProperty({ type: () => [PublicInvitationEventDto] })
  events: PublicInvitationEventDto[];

  @ApiProperty({ type: () => [PublicInvitationInviteeDto] })
  invitees: PublicInvitationInviteeDto[];

  @ApiProperty({ type: () => PublicInvitationRulesDto })
  rules: PublicInvitationRulesDto;

  @ApiProperty({
    nullable: true,
    type: () => PublicInvitationRsvpDto,
  })
  rsvp: PublicInvitationRsvpDto | null;
}

export class PublicInvitationResponseDto {
  @ApiProperty({ type: () => PublicInvitationDto })
  invitation: PublicInvitationDto;
}
