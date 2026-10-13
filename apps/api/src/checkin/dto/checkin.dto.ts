import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type {
  CheckinConfirmCommand,
  CheckinManualConfirmCommand,
  CheckinSearchCommand,
  CheckinValidateCommand,
} from "../checkin.service.js";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const QR_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SEARCH_MIN_CODE_POINTS = 2;
const VALIDATE_FIELDS = new Set(["eventId", "qrPayload"]);
const CONFIRM_FIELDS = new Set(["attendeeCount", "eventId", "qrPayload"]);
const MANUAL_CONFIRM_FIELDS = new Set([
  "attendeeCount",
  "eventId",
  "invitationId",
]);

export const adminCheckinValidateStatuses = [
  "VALID",
  "ALREADY_CONFIRMED",
] as const;
export type AdminCheckinValidateStatus =
  (typeof adminCheckinValidateStatuses)[number];

export const adminCheckinMethods = ["QR", "MANUAL"] as const;
export type AdminCheckinMethod = (typeof adminCheckinMethods)[number];

export class AdminCheckinEventDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String })
  slug: string;

  @ApiProperty({ format: "date-time", nullable: true, type: String })
  startsAt: string | null;
}

export class AdminCheckinEventsResponseDto {
  @ApiProperty({ type: () => [AdminCheckinEventDto] })
  events: AdminCheckinEventDto[];
}

export class ValidateAdminCheckinRequestDto {
  @ApiProperty({
    maxLength: 43,
    minLength: 43,
    pattern: "^[A-Za-z0-9_-]{43}$",
    type: String,
  })
  qrPayload: string;

  @ApiProperty({ format: "uuid", type: String })
  eventId: string;
}

export class ConfirmAdminCheckinRequestDto extends ValidateAdminCheckinRequestDto {
  @ApiProperty({ minimum: 1, type: Number })
  attendeeCount: number;
}

export class ManualConfirmAdminCheckinRequestDto {
  @ApiProperty({ format: "uuid", type: String })
  invitationId: string;

  @ApiProperty({ format: "uuid", type: String })
  eventId: string;

  @ApiProperty({ minimum: 1, type: Number })
  attendeeCount: number;
}

export class AdminCheckinInvitationSummaryDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  displayName: string;
}

export class AdminCheckinEventSummaryDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  name: string;
}

export class AdminCheckinOperatorDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ format: "email", type: String })
  email: string;

  @ApiProperty({ enum: ["OWNER", "CHECKIN_STAFF"], type: String })
  role: "OWNER" | "CHECKIN_STAFF";
}

export class AdminPreviousCheckinDto {
  @ApiProperty({ minimum: 1, type: Number })
  attendeeCount: number;

  @ApiProperty({ format: "date-time", type: String })
  checkedInAt: string;

  @ApiProperty({ enum: adminCheckinMethods, type: String })
  method: AdminCheckinMethod;

  @ApiPropertyOptional({ nullable: true, type: () => AdminCheckinOperatorDto })
  confirmedBy?: AdminCheckinOperatorDto | null;
}

export class AdminCheckinValidateResponseDto {
  @ApiProperty({ enum: adminCheckinValidateStatuses, type: String })
  status: AdminCheckinValidateStatus;

  @ApiProperty({ type: () => AdminCheckinInvitationSummaryDto })
  invitation: AdminCheckinInvitationSummaryDto;

  @ApiProperty({ type: () => AdminCheckinEventSummaryDto })
  event: AdminCheckinEventSummaryDto;

  @ApiProperty({ minimum: 1, type: Number })
  expectedAttendeeCount: number;

  @ApiProperty({ type: Boolean })
  alreadyCheckedIn: boolean;

  @ApiProperty({ nullable: true, type: () => AdminPreviousCheckinDto })
  previousCheckin: AdminPreviousCheckinDto | null;
}

export class AdminCheckinRecordDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ enum: adminCheckinMethods, type: String })
  method: AdminCheckinMethod;

  @ApiProperty({ minimum: 1, type: Number })
  attendeeCount: number;

  @ApiProperty({ format: "date-time", type: String })
  checkedInAt: string;

  @ApiProperty({ type: () => AdminCheckinOperatorDto })
  confirmedBy: AdminCheckinOperatorDto;
}

export class AdminCheckinConfirmResponseDto {
  @ApiProperty({ type: () => AdminCheckinRecordDto })
  checkinRecord: AdminCheckinRecordDto;
}

export class AdminCheckinSearchItemDto {
  @ApiProperty({ type: () => AdminCheckinInvitationSummaryDto })
  invitation: AdminCheckinInvitationSummaryDto;

  @ApiProperty({ type: () => AdminCheckinEventSummaryDto })
  event: AdminCheckinEventSummaryDto;

  @ApiProperty({ minimum: 1, type: Number })
  expectedAttendeeCount: number;

  @ApiProperty({ type: Boolean })
  alreadyCheckedIn: boolean;
}

export class AdminCheckinSearchResponseDto {
  @ApiProperty({ type: () => [AdminCheckinSearchItemDto] })
  items: AdminCheckinSearchItemDto[];
}

function badRequest(): never {
  throw new BadRequestException({
    code: "BAD_REQUEST",
    details: null,
    message: "Bad request",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoUnsupportedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    badRequest();
  }
}

function parseUuid(value: unknown): string {
  if (typeof value === "string" && UUID_PATTERN.test(value)) {
    return value;
  }

  badRequest();
}

function parseQrPayload(value: unknown): string {
  if (typeof value === "string" && QR_PAYLOAD_PATTERN.test(value)) {
    return value;
  }

  badRequest();
}

function parseAttendeeCount(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  badRequest();
}

export function mapValidateAdminCheckinRequest(
  body: unknown,
): CheckinValidateCommand {
  if (!isRecord(body)) {
    badRequest();
  }

  assertNoUnsupportedFields(body, VALIDATE_FIELDS);

  return {
    eventId: parseUuid(body.eventId),
    qrPayload: parseQrPayload(body.qrPayload),
  };
}

export function mapConfirmAdminCheckinRequest(
  body: unknown,
): CheckinConfirmCommand {
  if (!isRecord(body)) {
    badRequest();
  }

  assertNoUnsupportedFields(body, CONFIRM_FIELDS);

  return {
    attendeeCount: parseAttendeeCount(body.attendeeCount),
    eventId: parseUuid(body.eventId),
    qrPayload: parseQrPayload(body.qrPayload),
  };
}

export function mapManualConfirmAdminCheckinRequest(
  body: unknown,
): CheckinManualConfirmCommand {
  if (!isRecord(body)) {
    badRequest();
  }

  assertNoUnsupportedFields(body, MANUAL_CONFIRM_FIELDS);

  return {
    attendeeCount: parseAttendeeCount(body.attendeeCount),
    eventId: parseUuid(body.eventId),
    invitationId: parseUuid(body.invitationId),
  };
}

export function mapSearchAdminCheckinQuery(query: unknown): CheckinSearchCommand {
  if (!isRecord(query)) {
    badRequest();
  }

  const rawQuery = query.query;
  const rawEventId = query.eventId;

  if (typeof rawQuery !== "string") {
    badRequest();
  }

  const normalizedQuery = rawQuery.trim();

  if ([...normalizedQuery].length < SEARCH_MIN_CODE_POINTS) {
    badRequest();
  }

  return {
    eventId: parseUuid(rawEventId),
    query: normalizedQuery,
  };
}
