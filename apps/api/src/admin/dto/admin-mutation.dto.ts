import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  publicRsvpMutationStatuses,
  SubmitPublicRsvpAttendeeDto,
  SubmitPublicRsvpEventSelectionDto,
  type PublicRsvpMutationStatus,
} from "../../invitations/dto/public-rsvp.dto.js";
import {
  AdminInvitationDetailDto,
  AdminInvitationEligibilityDto,
  adminInviteeCategories,
  type AdminInviteeCategory,
  adminInvitationStatuses,
  type AdminInvitationStatus,
} from "./admin-read.dto.js";

export class CreateAdminInvitationInviteeDto {
  @ApiProperty({ type: String })
  fullName: string;

  @ApiProperty({ enum: adminInviteeCategories, type: String })
  category: AdminInviteeCategory;

  @ApiPropertyOptional({ nullable: true, type: String })
  label?: string | null;
}

export class CreateAdminInvitationRequestDto {
  @ApiProperty({ type: String })
  displayName: string;

  @ApiProperty({ nullable: true, type: String })
  greetingName: string | null;

  @ApiProperty({ type: Boolean })
  allowPlusOne: boolean;

  @ApiProperty({ minimum: 0, type: Number })
  maxAdditionalChildren: number;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  rsvpDeadlineAt: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ format: "uuid", isArray: true, type: String })
  eventIds: string[];

  @ApiProperty({ type: () => [CreateAdminInvitationInviteeDto] })
  invitees: CreateAdminInvitationInviteeDto[];
}

export class CreateAdminInvitationResponseDto {
  @ApiProperty({ type: () => AdminInvitationDetailDto })
  invitation: AdminInvitationDetailDto;

  @ApiProperty({ type: String })
  publicUrl: string;

  @ApiProperty({ minimum: 1, type: Number })
  publicTokenVersion: number;
}

export class UpdateAdminInvitationRequestDto {
  @ApiProperty({ format: "date-time", type: String })
  expectedUpdatedAt: string;

  @ApiPropertyOptional({ type: String })
  displayName?: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  greetingName?: string | null;

  @ApiPropertyOptional({ type: Boolean })
  allowPlusOne?: boolean;

  @ApiPropertyOptional({ minimum: 0, type: Number })
  maxAdditionalChildren?: number;

  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  rsvpDeadlineAt?: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  notes?: string | null;
}

export class ArchiveAdminInvitationSummaryDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ enum: adminInvitationStatuses, type: String })
  status: AdminInvitationStatus;

  @ApiProperty({ format: "date-time", type: String })
  archivedAt: string;
}

export class ArchiveAdminInvitationResponseDto {
  @ApiProperty({ type: () => ArchiveAdminInvitationSummaryDto })
  invitation: ArchiveAdminInvitationSummaryDto;
}

export class RegenerateInvitationTokenRequestDto {
  @ApiProperty({ minimum: 1, type: Number })
  expectedTokenVersion: number;
}

export class CreateAdminInviteeRequestDto {
  @ApiProperty({ type: String })
  fullName: string;

  @ApiProperty({ enum: adminInviteeCategories, type: String })
  category: AdminInviteeCategory;

  @ApiPropertyOptional({ nullable: true, type: String })
  label?: string | null;
}

export class UpdateAdminInviteeRequestDto {
  @ApiProperty({ format: "date-time", type: String })
  expectedUpdatedAt: string;

  @ApiPropertyOptional({ type: String })
  fullName?: string;

  @ApiPropertyOptional({ enum: adminInviteeCategories, type: String })
  category?: AdminInviteeCategory;

  @ApiPropertyOptional({ nullable: true, type: String })
  label?: string | null;
}

export class AdminInviteeMutationDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ format: "uuid", type: String })
  invitationId: string;

  @ApiProperty({ type: String })
  fullName: string;

  @ApiProperty({ enum: adminInviteeCategories, type: String })
  category: AdminInviteeCategory;

  @ApiProperty({ nullable: true, type: String })
  label: string | null;

  @ApiProperty({ type: Number })
  displayOrder: number;

  @ApiProperty({ format: "date-time", type: String })
  createdAt: string;

  @ApiProperty({ format: "date-time", type: String })
  updatedAt: string;
}

export class ReplaceAdminInvitationEventsRequestDto {
  @ApiProperty({ format: "uuid", isArray: true, type: String })
  eventIds: string[];
}

export class ReplaceAdminInvitationEventsResponseDto {
  @ApiProperty({ type: () => [AdminInvitationEligibilityDto] })
  eligibility: AdminInvitationEligibilityDto[];
}

export class OverrideAdminRsvpRequestDto {
  @ApiProperty({ nullable: true, minimum: 1, type: Number })
  expectedVersion: number | null;

  @ApiProperty({ enum: publicRsvpMutationStatuses, type: String })
  status: PublicRsvpMutationStatus;

  @ApiProperty({ type: () => [SubmitPublicRsvpEventSelectionDto] })
  eventSelections: SubmitPublicRsvpEventSelectionDto[];

  @ApiProperty({ type: () => [SubmitPublicRsvpAttendeeDto] })
  attendees: SubmitPublicRsvpAttendeeDto[];

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  dietaryNotes?: string | null;

  @ApiProperty({ maxLength: 500, type: String })
  overrideReason: string;
}
