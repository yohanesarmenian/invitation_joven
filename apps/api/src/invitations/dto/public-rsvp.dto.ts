import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { SubmitPublicRsvpCommand } from "../public-rsvp.service.js";

export const publicRsvpMutationStatuses = ["ACCEPTED", "DECLINED"] as const;
export type PublicRsvpMutationStatus =
  (typeof publicRsvpMutationStatuses)[number];

export const publicRsvpStatuses = ["PENDING", "ACCEPTED", "DECLINED"] as const;
export type PublicRsvpStatus = (typeof publicRsvpStatuses)[number];

export const publicRsvpAttendeeTypes = [
  "NAMED_INVITEE",
  "PLUS_ONE",
  "ADDITIONAL_CHILD",
] as const;
export type PublicRsvpAttendeeType = (typeof publicRsvpAttendeeTypes)[number];

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TOP_LEVEL_REQUEST_FIELDS = new Set([
  "attendees",
  "dietaryNotes",
  "eventSelections",
  "expectedVersion",
  "status",
]);

export class SubmitPublicRsvpEventSelectionDto {
  @ApiProperty({ format: "uuid", type: String })
  eventId: string;

  @ApiProperty({ type: Boolean })
  attending: boolean;

  @ApiProperty({ minimum: 0, type: Number })
  expectedAttendeeCount: number;
}

export class SubmitPublicRsvpAttendeeDto {
  @ApiProperty({ enum: publicRsvpAttendeeTypes, type: String })
  type: PublicRsvpAttendeeType;

  @ApiPropertyOptional({ format: "uuid", nullable: true, type: String })
  inviteeId?: string | null;

  @ApiProperty({ minimum: 1, type: Number })
  quantity: number;
}

export class SubmitPublicRsvpRequestDto {
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
}

export class PublicRsvpEventSelectionDto {
  @ApiProperty({ format: "uuid", type: String })
  eventId: string;

  @ApiProperty({ type: Boolean })
  attending: boolean;

  @ApiProperty({ minimum: 0, type: Number })
  expectedAttendeeCount: number;
}

export class PublicRsvpAttendeeDto {
  @ApiProperty({ enum: publicRsvpAttendeeTypes, type: String })
  type: PublicRsvpAttendeeType;

  @ApiProperty({ format: "uuid", nullable: true, type: String })
  inviteeId: string | null;

  @ApiProperty({ minimum: 1, type: Number })
  quantity: number;
}

export class PublicRsvpStateDto {
  @ApiProperty({ enum: publicRsvpStatuses, type: String })
  status: PublicRsvpStatus;

  @ApiProperty({ minimum: 1, type: Number })
  version: number;

  @ApiProperty({ nullable: true, type: String })
  dietaryNotes: string | null;

  @ApiProperty({ minimum: 0, type: Number })
  attendeeQuantityTotal: number;

  @ApiProperty({ type: () => [PublicRsvpEventSelectionDto] })
  eventSelections: PublicRsvpEventSelectionDto[];

  @ApiProperty({ type: () => [PublicRsvpAttendeeDto] })
  attendees: PublicRsvpAttendeeDto[];
}

export class PublicCheckinPassDto {
  @ApiProperty({ enum: ["ACTIVE"], type: String })
  status: "ACTIVE";

  @ApiProperty({ format: "date-time", type: String })
  issuedAt: string;
}

export class PublicRsvpMutationResponseDto {
  @ApiProperty({ type: () => PublicRsvpStateDto })
  rsvp: PublicRsvpStateDto;

  @ApiProperty({ nullable: true, type: () => PublicCheckinPassDto })
  checkinPass: PublicCheckinPassDto | null;
}

export class PublicRsvpReadResponseDto {
  @ApiProperty({ nullable: true, type: () => PublicRsvpStateDto })
  rsvp: PublicRsvpStateDto | null;

  @ApiProperty({ nullable: true, type: () => PublicCheckinPassDto })
  checkinPass: PublicCheckinPassDto | null;
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

function assertNoUnsupportedTopLevelFields(value: Record<string, unknown>): void {
  if (Object.keys(value).some((key) => !TOP_LEVEL_REQUEST_FIELDS.has(key))) {
    badRequest();
  }
}

function parseExpectedVersion(value: unknown): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }

  badRequest();
}

function parseStatus(value: unknown): PublicRsvpMutationStatus {
  if (value === "ACCEPTED" || value === "DECLINED") {
    return value;
  }

  badRequest();
}

function parseUuid(value: unknown): string {
  if (typeof value === "string" && UUID_PATTERN.test(value)) {
    return value;
  }

  badRequest();
}

function parseNonNegativeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  badRequest();
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }

  badRequest();
}

function parseEventSelections(value: unknown): SubmitPublicRsvpCommand["eventSelections"] {
  if (!Array.isArray(value)) {
    badRequest();
  }

  return value.map((selection) => {
    if (!isRecord(selection)) {
      badRequest();
    }

    if (typeof selection.attending !== "boolean") {
      badRequest();
    }

    return {
      attending: selection.attending,
      eventId: parseUuid(selection.eventId),
      expectedAttendeeCount: parseNonNegativeInteger(
        selection.expectedAttendeeCount,
      ),
    };
  });
}

function parseAttendeeType(value: unknown): PublicRsvpAttendeeType {
  if (
    value === "NAMED_INVITEE" ||
    value === "PLUS_ONE" ||
    value === "ADDITIONAL_CHILD"
  ) {
    return value;
  }

  badRequest();
}

function parseInviteeId(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return parseUuid(value);
}

function parseAttendees(value: unknown): SubmitPublicRsvpCommand["attendees"] {
  if (!Array.isArray(value)) {
    badRequest();
  }

  return value.map((attendee) => {
    if (!isRecord(attendee)) {
      badRequest();
    }

    return {
      inviteeId: parseInviteeId(attendee.inviteeId),
      quantity: parsePositiveInteger(attendee.quantity),
      type: parseAttendeeType(attendee.type),
    };
  });
}

function parseDietaryNotes(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  badRequest();
}

export function mapSubmitPublicRsvpRequest(
  publicCredential: string,
  body: unknown,
): SubmitPublicRsvpCommand {
  if (!isRecord(body)) {
    badRequest();
  }

  assertNoUnsupportedTopLevelFields(body);

  if (
    !Object.hasOwn(body, "expectedVersion") ||
    !Object.hasOwn(body, "status") ||
    !Object.hasOwn(body, "eventSelections") ||
    !Object.hasOwn(body, "attendees")
  ) {
    badRequest();
  }

  return {
    attendees: parseAttendees(body.attendees),
    dietaryNotes: parseDietaryNotes(body.dietaryNotes),
    eventSelections: parseEventSelections(body.eventSelections),
    expectedVersion: parseExpectedVersion(body.expectedVersion),
    publicCredential,
    status: parseStatus(body.status),
  };
}
