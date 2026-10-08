import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export const guestImportRowStatuses = [
  "VALID",
  "VALID_WITH_WARNINGS",
  "ERROR",
] as const;

export const guestImportIssueCodes = [
  "REQUIRED_FIELD",
  "INVALID_VALUE",
  "INVALID_JSON",
  "INVALID_DATE",
  "UNKNOWN_EVENT",
  "INACTIVE_EVENT",
  "INVALID_INVITEE",
  "POSSIBLE_DUPLICATE",
] as const;

export type GuestImportRowStatus = (typeof guestImportRowStatuses)[number];
export type GuestImportIssueCode = (typeof guestImportIssueCodes)[number];

export class GuestImportIssueDto {
  @ApiProperty({ type: Number })
  rowNumber: number;

  @ApiProperty({ nullable: true, type: String })
  column: string | null;

  @ApiProperty({ nullable: true, type: String })
  field: string | null;

  @ApiProperty({ enum: guestImportIssueCodes, type: String })
  code: GuestImportIssueCode;

  @ApiProperty({ type: String })
  message: string;
}

export class GuestImportParsedInviteeDto {
  @ApiProperty({ type: String })
  fullName: string;

  @ApiProperty({ enum: ["ADULT", "CHILD"], type: String })
  category: "ADULT" | "CHILD";

  @ApiProperty({ nullable: true, type: String })
  label: string | null;
}

export class GuestImportParsedRowDto {
  @ApiProperty({ type: String })
  displayName: string;

  @ApiProperty({ nullable: true, type: String })
  greetingName: string | null;

  @ApiProperty({ type: Boolean })
  allowPlusOne: boolean;

  @ApiProperty({ type: Number })
  maxAdditionalChildren: number;

  @ApiProperty({ nullable: true, type: String })
  rsvpDeadlineLocal: string | null;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  rsvpDeadlineAt: string | null;

  @ApiProperty({ type: () => [GuestImportParsedInviteeDto] })
  invitees: GuestImportParsedInviteeDto[];

  @ApiProperty({ isArray: true, type: String })
  eligibleEventSlugs: string[];
}

export class GuestImportPreviewRowDto {
  @ApiProperty({ type: Number })
  rowNumber: number;

  @ApiProperty({ enum: guestImportRowStatuses, type: String })
  status: GuestImportRowStatus;

  @ApiProperty({ type: () => [GuestImportIssueDto] })
  errors: GuestImportIssueDto[];

  @ApiProperty({ type: () => [GuestImportIssueDto] })
  warnings: GuestImportIssueDto[];

  @ApiPropertyOptional({ type: () => GuestImportParsedRowDto })
  parsed?: GuestImportParsedRowDto;
}

export class GuestImportPreviewSummaryDto {
  @ApiProperty({ type: Number })
  totalRows: number;

  @ApiProperty({ type: Number })
  validRows: number;

  @ApiProperty({ type: Number })
  errorRows: number;

  @ApiProperty({ type: Number })
  warningRows: number;
}

export class GuestImportValidateResponseDto {
  @ApiProperty({ format: "uuid", type: String })
  previewId: string;

  @ApiProperty({ format: "date-time", type: String })
  expiresAt: string;

  @ApiProperty({ type: () => GuestImportPreviewSummaryDto })
  summary: GuestImportPreviewSummaryDto;

  @ApiProperty({ type: () => [GuestImportPreviewRowDto] })
  rows: GuestImportPreviewRowDto[];
}

export class GuestImportCommitRequestDto {
  @ApiProperty({ format: "uuid", type: String })
  previewId: string;

  @ApiProperty({ isArray: true, type: Number })
  includeRowNumbers: number[];

  @ApiProperty({ isArray: true, type: Number })
  acknowledgedWarningRowNumbers: number[];
}

export class GuestImportBatchReceiptDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ enum: ["COMMITTED"], type: String })
  status: "COMMITTED";

  @ApiProperty({ type: Number })
  createdInvitationCount: number;

  @ApiProperty({ type: Number })
  createdInviteeCount: number;

  @ApiProperty({ type: Number })
  warningCount: number;
}

export class GuestImportCommitResponseDto {
  @ApiProperty({ type: () => GuestImportBatchReceiptDto })
  importBatch: GuestImportBatchReceiptDto;
}
