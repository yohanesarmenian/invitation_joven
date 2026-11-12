import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  SubmitPublicRsvpRequestDto,
  mapSubmitPublicRsvpRequest,
} from "../invitations/dto/public-rsvp.dto.js";

import {
  ReceptionAdjustmentDto,
  ReceptionRegistrationDto,
} from "./reception-actions.dto.js";
export class ReceptionInviteeDto {
  @ApiProperty({ type: String, format: "uuid" }) id: string;
  @ApiProperty({ type: String }) fullName: string;
}
export class ReceptionArrivalDto {
  @ApiProperty({ type: String, format: "uuid" }) operationId: string;
  @ApiProperty({ type: Number }) attendeeCount: number;
  @ApiProperty({ type: Number }) expectedAttendeeCount: number;
  @ApiProperty({ type: Number }) totalAfter: number;
  @ApiProperty({ type: String, format: "date-time" }) checkedInAt: string;
  @ApiProperty({ type: String, enum: ["QR", "MANUAL"] }) method:
    "QR" | "MANUAL";
  @ApiProperty({ type: String, format: "uuid" }) operatorId: string;
  @ApiProperty({ type: String }) actorRole: string;
  @ApiProperty({ type: String }) verificationMethod: string;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ type: Boolean }) migrated: boolean;
}
export class ReceptionHouseholdDto {
  @ApiProperty({ type: String, format: "uuid" }) id: string;
  @ApiProperty({ type: String }) displayName: string;
  @ApiProperty({ type: String }) referenceCode: string;
  @ApiProperty({ type: String, enum: ["PENDING", "ACCEPTED", "DECLINED"] })
  rsvpStatus: "PENDING" | "ACCEPTED" | "DECLINED";
  @ApiProperty({ type: Number, nullable: true }) rsvpVersion: number | null;
  @ApiProperty({ type: Boolean }) eligible: boolean;
  @ApiProperty({ type: Boolean }) rsvpLocked: boolean;
  @ApiProperty({ type: String, enum: ["REGISTERED", "WALKIN"] }) source:
    "REGISTERED" | "WALKIN";
  @ApiProperty({ type: Number }) baseExpectedCount: number;
  @ApiProperty({ type: Number }) exceptionAllowance: number;
  @ApiProperty({ type: Number }) attendanceRevision: number;
  @ApiProperty({ type: Number }) unnamedCompanionAllowance: number;
  @ApiProperty({ type: Number }) allowedCount: number;
  @ApiProperty({ type: Number }) expectedCount: number;
  @ApiProperty({ type: Number }) arrivedCount: number;
  @ApiProperty({ type: Number }) remainingCount: number;
  @ApiProperty({ type: Boolean }) allowPlusOne: boolean;
  @ApiProperty({ type: Number }) maxAdditionalChildren: number;
  @ApiProperty({ type: () => [ReceptionInviteeDto] })
  invitees: ReceptionInviteeDto[];
}
export class ReceptionDetailDto {
  @ApiProperty({ type: () => ReceptionRegistrationDto, nullable: true })
  registration: ReceptionRegistrationDto | null;
  @ApiProperty({ type: () => [ReceptionAdjustmentDto] })
  actions: ReceptionAdjustmentDto[];
  @ApiProperty({ type: () => ReceptionHouseholdDto })
  household: ReceptionHouseholdDto;
  @ApiProperty({ type: () => [ReceptionArrivalDto] })
  arrivals: ReceptionArrivalDto[];
}
export class ReceptionSearchDto {
  @ApiProperty({ type: () => [ReceptionHouseholdDto] })
  items: ReceptionHouseholdDto[];
  @ApiProperty({ type: Number }) page: number;
  @ApiProperty({ type: Boolean }) hasMore: boolean;
}
export class ReceptionReceiptDto {
  @ApiProperty({ type: () => ReceptionArrivalDto })
  arrival: ReceptionArrivalDto;
}
export class ReceptionOperationDto {
  @ApiProperty({ type: () => ReceptionArrivalDto, nullable: true })
  arrival: ReceptionArrivalDto | null;
}
export class ReceptionStatisticsDto {
  @ApiProperty({ type: Number }) walkinHouseholds: number;
  @ApiProperty({ type: Number }) registeredExpectedGuests: number;
  @ApiProperty({ type: Number }) walkinExpectedGuests: number;
  @ApiProperty({ type: Number }) walkinArrivedGuests: number;
  @ApiProperty({ type: Number }) correctionOperations: number;
  @ApiProperty({ type: Number }) exceptionalGuests: number;
  @ApiProperty({ type: Number }) registeredHouseholds: number;
  @ApiProperty({ type: Number }) pendingHouseholds: number;
  @ApiProperty({ type: Number }) acceptedHouseholds: number;
  @ApiProperty({ type: Number }) declinedHouseholds: number;
  @ApiProperty({ type: Number }) expectedGuests: number;
  @ApiProperty({ type: Number }) arrivedGuests: number;
  @ApiProperty({ type: Number }) partialHouseholds: number;
  @ApiProperty({ type: Number }) completedHouseholds: number;
  @ApiProperty({ type: Number }) qrGuests: number;
  @ApiProperty({ type: Number }) manualGuests: number;
  @ApiProperty({ type: Number }) onSiteConfirmations: number;
}
export class ReceptionOnSiteDto extends SubmitPublicRsvpRequestDto {
  @ApiProperty({ type: String, maxLength: 500 }) reason: string;
}
export class ReceptionIdentifyDto {
  @ApiProperty({ type: String, format: "uuid" }) eventId: string;
  @ApiProperty({ type: String, minLength: 43, maxLength: 43 })
  qrPayload: string;
}
export class ReceptionArrivalRequestDto {
  @ApiProperty({ type: String, format: "uuid" }) operationId: string;
  @ApiProperty({ type: String, format: "uuid" }) invitationId: string;
  @ApiProperty({ type: String, format: "uuid" }) eventId: string;
  @ApiProperty({ type: Number, minimum: 1 }) attendeeCount: number;
  @ApiProperty({ type: String, enum: ["QR", "MANUAL"] }) method:
    "QR" | "MANUAL";
  @ApiPropertyOptional({ type: String, minLength: 43, maxLength: 43 })
  qrPayload?: string;
  @ApiProperty({
    type: String,
    enum: ["QR", "PHYSICAL_INVITATION", "HOUSEHOLD_DETAILS"],
  })
  verificationMethod: "QR" | "PHYSICAL_INVITATION" | "HOUSEHOLD_DETAILS";
  @ApiPropertyOptional({ type: () => ReceptionOnSiteDto })
  onSite?: ReceptionOnSiteDto;
}

export function invalid(): never {
  throw new BadRequestException({
    code: "BAD_REQUEST",
    details: null,
    message: "Invalid reception request",
  });
}
export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
  )
    invalid();
  return value.toLowerCase();
}
export function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid();
}
export function identify(value: unknown): ReceptionIdentifyDto {
  if (!object(value)) invalid();
  only(value, ["eventId", "qrPayload"]);
  if (
    typeof value.qrPayload !== "string" ||
    !/^[\w-]{43}$/.test(value.qrPayload)
  )
    invalid();
  return { eventId: uuid(value.eventId), qrPayload: value.qrPayload };
}
export function arrivalRequest(value: unknown): ReceptionArrivalRequestDto {
  if (!object(value)) invalid();
  only(value, [
    "operationId",
    "invitationId",
    "eventId",
    "attendeeCount",
    "method",
    "qrPayload",
    "verificationMethod",
    "onSite",
  ]);
  if (
    !Number.isSafeInteger(value.attendeeCount) ||
    Number(value.attendeeCount) < 1
  )
    invalid();
  if (value.method !== "QR" && value.method !== "MANUAL") invalid();
  if (
    !["QR", "PHYSICAL_INVITATION", "HOUSEHOLD_DETAILS"].includes(
      String(value.verificationMethod),
    )
  )
    invalid();
  if (value.method === "QR") {
    identify({ eventId: value.eventId, qrPayload: value.qrPayload });
    if (value.verificationMethod !== "QR" || value.onSite !== undefined)
      invalid();
  } else if (value.qrPayload !== undefined || value.verificationMethod === "QR")
    invalid();
  let onSite: ReceptionOnSiteDto | undefined;
  if (value.onSite !== undefined) {
    if (!object(value.onSite)) invalid();
    const { reason, ...rsvp } = value.onSite;
    if (
      typeof reason !== "string" ||
      reason.trim().length < 3 ||
      reason.trim().length > 500
    )
      invalid();
    const parsed = mapSubmitPublicRsvpRequest("reception", rsvp);
    if (parsed.status !== "ACCEPTED") invalid();
    onSite = {
      expectedVersion: parsed.expectedVersion,
      status: parsed.status,
      attendees: parsed.attendees.map((item) => ({
        ...item,
        type: item.type as ReceptionOnSiteDto["attendees"][number]["type"],
      })),
      eventSelections: parsed.eventSelections,
      dietaryNotes: parsed.dietaryNotes,
      reason: reason.trim(),
    };
  }
  return {
    operationId: uuid(value.operationId),
    invitationId: uuid(value.invitationId),
    eventId: uuid(value.eventId),
    attendeeCount: Number(value.attendeeCount),
    method: value.method,
    verificationMethod:
      value.verificationMethod as ReceptionArrivalRequestDto["verificationMethod"],
    ...(value.method === "QR" ? { qrPayload: value.qrPayload as string } : {}),
    ...(onSite ? { onSite } : {}),
  };
}
