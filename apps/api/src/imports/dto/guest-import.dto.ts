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

export class GuestImportParsedRowDto {
  @ApiProperty({ type: String })
  displayName: string;
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
