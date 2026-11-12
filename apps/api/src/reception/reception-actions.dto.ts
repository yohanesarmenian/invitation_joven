import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { invalid, object, only, uuid } from "./reception.dto.js";
export const verifications = [
  "PHYSICAL_INVITATION",
  "VERBAL_IDENTIFICATION",
  "FAMILY_REFERENCE",
  "OTHER",
] as const;
export const affiliations = [
  "BRIDE_FAMILY",
  "GROOM_FAMILY",
  "FRIEND",
  "COLLEAGUE",
  "OTHER",
] as const;
export class WalkinRequestDto {
  @ApiProperty({ type: String, format: "uuid" }) operationId: string;
  @ApiProperty({ type: String, format: "uuid" }) eventId: string;
  @ApiProperty({ type: String, minLength: 2, maxLength: 100 }) leadName: string;
  @ApiProperty({ type: Number, minimum: 1, maximum: 25 }) arrivingCount: number;
  @ApiProperty({ type: Number, minimum: 1, maximum: 25 }) expectedCount: number;
  @ApiProperty({ type: String, enum: affiliations })
  affiliation: (typeof affiliations)[number];
  @ApiProperty({ type: String, enum: verifications })
  verificationMethod: (typeof verifications)[number];
  @ApiProperty({ type: String, minLength: 3, maxLength: 500 }) reason: string;
  @ApiProperty({ type: Boolean }) lookupConfirmed: boolean;
  @ApiProperty({ type: [String] }) reviewedMatchIds: string[];
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  duplicateOverrideReason?: string | null;
}
export class AttendanceActionRequestDto {
  @ApiProperty({ type: String, format: "uuid" }) operationId: string;
  @ApiProperty({ type: String, format: "uuid" }) invitationId: string;
  @ApiProperty({ type: String, format: "uuid" }) eventId: string;
  @ApiProperty({ type: Number, minimum: 1 }) expectedRevision: number;
  @ApiProperty({ type: Number, minimum: 0 }) count: number;
  @ApiProperty({ type: String, enum: ["QR", "MANUAL"] }) method:
    "QR" | "MANUAL";
  @ApiProperty({ type: String, enum: verifications })
  verificationMethod: (typeof verifications)[number];
  @ApiProperty({ type: String, minLength: 3, maxLength: 500 }) reason: string;
}
export class ReceptionActionReceiptDto {
  @ApiProperty({ type: String, format: "uuid" }) operationId: string;
  @ApiProperty({ type: String, enum: ["WALKIN", "CORRECTION", "EXCEPTION"] })
  kind: string;
  @ApiProperty({ type: String, format: "uuid" }) invitationId: string;
  @ApiProperty({ type: String, format: "uuid" }) eventId: string;
  @ApiProperty({ type: String }) displayName: string;
  @ApiProperty({ type: String }) referenceCode: string;
  @ApiProperty({ type: Number }) arrivedCount: number;
  @ApiProperty({ type: Number }) expectedCount: number;
  @ApiProperty({ type: Number }) remainingCount: number;
  @ApiProperty({ type: String, format: "uuid" }) operatorId: string;
  @ApiProperty({ type: String }) confirmedAt: string;
  @ApiProperty({ type: Number }) delta: number;
  @ApiProperty({ type: Number }) capacityDelta: number;
}
export class ReceptionActionStatusDto {
  @ApiProperty({ type: () => ReceptionActionReceiptDto, nullable: true })
  receipt: ReceptionActionReceiptDto | null;
}
export class ReceptionAdjustmentDto {
  @ApiProperty({ type: String }) operationId: string;
  @ApiProperty({ type: String }) kind: string;
  @ApiProperty({ type: Number }) delta: number;
  @ApiProperty({ type: Number }) capacityDelta: number;
  @ApiProperty({ type: String }) method: string;
  @ApiProperty({ type: String }) reason: string;
  @ApiProperty({ type: String }) verificationMethod: string;
  @ApiProperty({ type: String }) operatorId: string;
  @ApiProperty({ type: String }) actorRole: string;
  @ApiProperty({ type: String }) createdAt: string;
}
export class ReceptionRegistrationDto {
  @ApiProperty({ type: String }) id: string;
  @ApiProperty({ type: String }) operationId: string;
  @ApiProperty({ type: String }) leadName: string;
  @ApiProperty({ type: Number }) companionCount: number;
  @ApiProperty({ type: Number }) expectedCount: number;
  @ApiProperty({ type: Number }) arrivingCount: number;
  @ApiProperty({ type: String }) affiliation: string;
  @ApiProperty({ type: String, nullable: true }) duplicateOverrideReason:
    string | null;
}
export function text(v: unknown, min: number, max: number) {
  if (typeof v !== "string") invalid();
  const value = v.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (
    value.length < min ||
    value.length > max ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    invalid();
  return value;
}
function integer(v: unknown, min: number, max: number) {
  if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max) invalid();
  return Number(v);
}
function verification(v: unknown) {
  if (!verifications.includes(v as never)) invalid();
  return v as (typeof verifications)[number];
}
export function walkinRequest(v: unknown): WalkinRequestDto {
  if (!object(v)) invalid();
  only(v, [
    "operationId",
    "eventId",
    "leadName",
    "arrivingCount",
    "expectedCount",
    "affiliation",
    "verificationMethod",
    "reason",
    "lookupConfirmed",
    "reviewedMatchIds",
    "duplicateOverrideReason",
  ]);
  if (
    v.lookupConfirmed !== true ||
    !Array.isArray(v.reviewedMatchIds) ||
    v.reviewedMatchIds.length > 25 ||
    !affiliations.includes(v.affiliation as never)
  )
    invalid();
  const reviewedMatchIds = v.reviewedMatchIds.map(uuid).sort();
  if (new Set(reviewedMatchIds).size !== reviewedMatchIds.length) invalid();
  const expectedCount = integer(v.expectedCount, 1, 25),
    arrivingCount = integer(v.arrivingCount, 1, expectedCount);
  return {
    operationId: uuid(v.operationId),
    eventId: uuid(v.eventId),
    leadName: text(v.leadName, 2, 100),
    arrivingCount,
    expectedCount,
    affiliation: v.affiliation as WalkinRequestDto["affiliation"],
    verificationMethod: verification(v.verificationMethod),
    reason: text(v.reason, 3, 500),
    lookupConfirmed: true,
    reviewedMatchIds,
    duplicateOverrideReason:
      v.duplicateOverrideReason == null
        ? null
        : text(v.duplicateOverrideReason, 3, 500),
  };
}
export function actionRequest(v: unknown): AttendanceActionRequestDto {
  if (!object(v)) invalid();
  only(v, [
    "operationId",
    "invitationId",
    "eventId",
    "expectedRevision",
    "count",
    "method",
    "verificationMethod",
    "reason",
  ]);
  if (v.method !== "QR" && v.method !== "MANUAL") invalid();
  return {
    operationId: uuid(v.operationId),
    invitationId: uuid(v.invitationId),
    eventId: uuid(v.eventId),
    expectedRevision: integer(v.expectedRevision, 1, 2147483647),
    count: integer(v.count, 0, 2147483647),
    method: v.method,
    verificationMethod: verification(v.verificationMethod),
    reason: text(v.reason, 3, 500),
  };
}
