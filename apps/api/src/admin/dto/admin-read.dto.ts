import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export const adminInvitationStatuses = ["ACTIVE", "ARCHIVED"] as const;
export type AdminInvitationStatus = (typeof adminInvitationStatuses)[number];

export const adminRsvpStatuses = ["PENDING", "ACCEPTED", "DECLINED"] as const;
export type AdminRsvpStatus = (typeof adminRsvpStatuses)[number];

export const adminInviteeCategories = ["ADULT", "CHILD"] as const;
export type AdminInviteeCategory = (typeof adminInviteeCategories)[number];

export const adminCheckinPassStatuses = [
  "ACTIVE",
  "REVOKED",
  "EXPIRED",
] as const;
export type AdminCheckinPassStatus = (typeof adminCheckinPassStatuses)[number];

export const adminInvitationSortFields = [
  "createdAt",
  "updatedAt",
  "displayName",
  "status",
  "lastOpenedAt",
] as const;
export type AdminInvitationSortField =
  (typeof adminInvitationSortFields)[number];

export class AdminPageMetadataDto {
  @ApiProperty({ minimum: 1, type: Number })
  number: number;

  @ApiProperty({ maximum: 100, minimum: 1, type: Number })
  pageSize: number;

  @ApiProperty({ minimum: 0, type: Number })
  totalItems: number;

  @ApiProperty({ minimum: 0, type: Number })
  totalPages: number;
}

export class AdminDashboardInvitationMetricsDto {
  @ApiProperty({ minimum: 0, type: Number })
  active: number;

  @ApiProperty({ minimum: 0, type: Number })
  archived: number;

  @ApiProperty({ minimum: 0, type: Number })
  openedActive: number;
}

export class AdminDashboardRsvpMetricsDto {
  @ApiProperty({ minimum: 0, type: Number })
  pending: number;

  @ApiProperty({ minimum: 0, type: Number })
  accepted: number;

  @ApiProperty({ minimum: 0, type: Number })
  declined: number;
}

export class AdminDashboardEventDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  slug: string;

  @ApiProperty({ type: String })
  name: string;
}

export class AdminDashboardExpectedByEventDto {
  @ApiProperty({ type: () => AdminDashboardEventDto })
  event: AdminDashboardEventDto;

  @ApiProperty({ minimum: 0, type: Number })
  expectedAttendeeCount: number;
}

export class AdminDashboardResponseDto {
  @ApiProperty({ type: () => AdminDashboardInvitationMetricsDto })
  invitations: AdminDashboardInvitationMetricsDto;

  @ApiProperty({ type: () => AdminDashboardRsvpMetricsDto })
  rsvp: AdminDashboardRsvpMetricsDto;

  @ApiProperty({ type: () => [AdminDashboardExpectedByEventDto] })
  expectedByEvent: AdminDashboardExpectedByEventDto[];
}

export class AdminEventDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  slug: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Boolean })
  isActive: boolean;

  @ApiProperty({ type: Number })
  displayOrder: number;
}

export class AdminEventsResponseDto {
  @ApiProperty({ type: () => [AdminEventDto] })
  events: AdminEventDto[];
}

export class AdminInvitationListQueryDto {
  @ApiPropertyOptional({ enum: adminInvitationStatuses, type: String })
  status?: AdminInvitationStatus;

  @ApiPropertyOptional({ enum: adminRsvpStatuses, type: String })
  rsvpStatus?: AdminRsvpStatus;

  @ApiPropertyOptional({ maxLength: 100, type: String })
  search?: string;

  @ApiPropertyOptional({ enum: adminInvitationSortFields, type: String })
  sortBy?: AdminInvitationSortField;

  @ApiPropertyOptional({ enum: ["asc", "desc"], type: String })
  sortOrder?: "asc" | "desc";

  @ApiPropertyOptional({ minimum: 1, type: Number })
  page?: number;

  @ApiPropertyOptional({ maximum: 100, minimum: 1, type: Number })
  pageSize?: number;
}

export class AdminInvitationListItemDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  displayName: string;

  @ApiProperty({ nullable: true, type: String })
  greetingName: string | null;

  @ApiProperty({ enum: adminInvitationStatuses, type: String })
  status: AdminInvitationStatus;

  @ApiProperty({ enum: adminRsvpStatuses, type: String })
  rsvpStatus: AdminRsvpStatus;

  @ApiProperty({ minimum: 0, type: Number })
  inviteeCount: number;

  @ApiProperty({ minimum: 0, type: Number })
  openCount: number;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  lastOpenedAt: string | null;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  rsvpDeadlineAt: string | null;

  @ApiProperty({ format: "date-time", type: String })
  createdAt: string;

  @ApiProperty({ format: "date-time", type: String })
  updatedAt: string;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  archivedAt: string | null;
}

export class AdminInvitationListResponseDto {
  @ApiProperty({ type: () => [AdminInvitationListItemDto] })
  items: AdminInvitationListItemDto[];

  @ApiProperty({ type: () => AdminPageMetadataDto })
  page: AdminPageMetadataDto;
}

export class AdminInviteeDetailDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  fullName: string;

  @ApiProperty({ enum: adminInviteeCategories, type: String })
  category: AdminInviteeCategory;

  @ApiProperty({ nullable: true, type: String })
  label: string | null;

  @ApiProperty({ type: Number })
  displayOrder: number;
}

export class AdminInvitationEligibilityDto {
  @ApiProperty({ type: () => AdminEventDto })
  event: AdminEventDto;
}

export class AdminInvitationRsvpSummaryDto {
  @ApiProperty({ enum: adminRsvpStatuses, type: String })
  status: AdminRsvpStatus;

  @ApiProperty({ minimum: 1, type: Number })
  version: number;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  submittedAt: string | null;

  @ApiProperty({ format: "date-time", type: String })
  lastUpdatedAt: string;
}

export class AdminGuestMessageSummaryDto {
  @ApiProperty({ minimum: 0, type: Number })
  total: number;

  @ApiProperty({ minimum: 0, type: Number })
  hidden: number;
}

export class AdminCheckinPassMetadataDto {
  @ApiProperty({ enum: adminCheckinPassStatuses, type: String })
  status: AdminCheckinPassStatus;

  @ApiProperty({ minimum: 1, type: Number })
  credentialVersion: number;

  @ApiProperty({ format: "date-time", type: String })
  issuedAt: string;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  revokedAt: string | null;

  @ApiProperty({ nullable: true, type: String })
  revocationReason: string | null;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  expiresAt: string | null;
}

export class AdminInvitationDetailDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  displayName: string;

  @ApiProperty({ nullable: true, type: String })
  greetingName: string | null;

  @ApiProperty({ enum: adminInvitationStatuses, type: String })
  status: AdminInvitationStatus;

  @ApiProperty({ type: Boolean })
  allowPlusOne: boolean;

  @ApiProperty({ minimum: 0, type: Number })
  maxAdditionalChildren: number;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  rsvpDeadlineAt: string | null;

  @ApiProperty({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ minimum: 1, type: Number })
  publicTokenVersion: number;

  @ApiProperty({ minimum: 0, type: Number })
  openCount: number;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  firstOpenedAt: string | null;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  lastOpenedAt: string | null;

  @ApiProperty({ format: "date-time", type: String })
  createdAt: string;

  @ApiProperty({ format: "date-time", type: String })
  updatedAt: string;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  archivedAt: string | null;

  @ApiProperty({ type: () => [AdminInviteeDetailDto] })
  invitees: AdminInviteeDetailDto[];

  @ApiProperty({ type: () => [AdminInvitationEligibilityDto] })
  eligibility: AdminInvitationEligibilityDto[];

  @ApiProperty({ nullable: true, type: () => AdminInvitationRsvpSummaryDto })
  rsvp: AdminInvitationRsvpSummaryDto | null;

  @ApiProperty({ type: () => AdminGuestMessageSummaryDto })
  messages: AdminGuestMessageSummaryDto;

  @ApiProperty({ type: () => [AdminCheckinPassMetadataDto] })
  checkinPasses: AdminCheckinPassMetadataDto[];
}

export class AdminInvitationDetailResponseDto {
  @ApiProperty({ type: () => AdminInvitationDetailDto })
  invitation: AdminInvitationDetailDto;
}

export class AdminInvitationPublicUrlResponseDto {
  @ApiProperty({ type: String })
  publicUrl: string;

  @ApiProperty({ minimum: 1, type: Number })
  publicTokenVersion: number;
}
