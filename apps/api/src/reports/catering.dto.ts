import { ApiProperty } from "@nestjs/swagger";

export class CateringScopeDto {
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  eventId!: string | null;

  @ApiProperty({ type: Boolean })
  includeArchived!: boolean;
}

export class FreezeCateringDto extends CateringScopeDto {
  @ApiProperty({ type: String, format: "uuid" })
  operationId!: string;

  @ApiProperty({
    type: Number,
    description: "Latest snapshot version seen, or zero.",
  })
  expectedVersion!: number;
}

export class CateringSnapshotDto extends CateringScopeDto {
  @ApiProperty({ type: Number })
  version!: number;

  @ApiProperty({ type: Number })
  schemaVersion!: number;

  @ApiProperty({ type: String, format: "date-time" })
  capturedAt!: string;

  @ApiProperty({ type: String, format: "uuid" })
  capturedById!: string;
}

export class CateringEventTotalsDto {
  @ApiProperty({ type: String, format: "uuid" })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: Number })
  expected!: number;

  @ApiProperty({ type: Number })
  rsvpExpected!: number;

  @ApiProperty({ type: Number })
  capacityAdjustment!: number;

  @ApiProperty({ type: Number })
  actual!: number;

  @ApiProperty({ type: Number })
  partialHouseholds!: number;

  @ApiProperty({ type: Number })
  walkinActual!: number;
}

export class CateringTotalsDto {
  @ApiProperty({ type: Number })
  households!: number;

  @ApiProperty({ type: Number })
  namedInvitees!: number;

  @ApiProperty({ type: Number })
  accepted!: number;

  @ApiProperty({ type: Number })
  declined!: number;

  @ApiProperty({ type: Number })
  pending!: number;

  @ApiProperty({ type: [CateringEventTotalsDto] })
  events!: CateringEventTotalsDto[];
}

export class CateringLiveDto extends CateringScopeDto {
  @ApiProperty({ type: String, format: "date-time" })
  generatedAt!: string;

  @ApiProperty({ type: CateringTotalsDto })
  totals!: CateringTotalsDto;
}

export class CateringChangeDto {
  @ApiProperty({ type: String, format: "uuid" })
  invitationId!: string;

  @ApiProperty({ type: String, format: "uuid" })
  eventId!: string;

  @ApiProperty({ type: String, nullable: true })
  previousStatus!: string | null;

  @ApiProperty({ type: String, nullable: true })
  currentStatus!: string | null;

  @ApiProperty({ type: Number })
  frozenExpected!: number;

  @ApiProperty({ type: Number })
  currentExpected!: number;

  @ApiProperty({ type: Number })
  netChange!: number;

  @ApiProperty({ type: [String] })
  changes!: string[];

  @ApiProperty({ type: [String] })
  evidence!: string[];
}

export class CateringComparisonDto {
  @ApiProperty({ type: CateringSnapshotDto })
  snapshot!: CateringSnapshotDto;

  @ApiProperty({ type: String, format: "date-time" })
  generatedAt!: string;

  @ApiProperty({ type: CateringTotalsDto })
  frozen!: CateringTotalsDto;

  @ApiProperty({ type: CateringTotalsDto })
  live!: CateringTotalsDto;

  @ApiProperty({ type: [CateringChangeDto] })
  changes!: CateringChangeDto[];
}
