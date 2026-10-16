import { ApiProperty } from "@nestjs/swagger";

export class EventFieldsDto {
  @ApiProperty({
    type: String,
    maxLength: 80,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  })
  slug!: string;
  @ApiProperty({ type: String, maxLength: 200 }) name!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 2000 })
  description!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  startsAt!: string | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  endsAt!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 300 })
  venueName!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 2000 })
  address!: string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 2048 })
  googleMapsUrl!: string | null;
  @ApiProperty({ type: "integer", minimum: 0, maximum: 2147483647 })
  displayOrder!: number;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
}
export class SaveEventDto extends EventFieldsDto {
  @ApiProperty({ type: "integer", minimum: 1 }) expectedVersion!: number;
}
export class EventUsageDto {
  @ApiProperty({ type: "integer" }) invitations!: number;
  @ApiProperty({ type: "integer" }) rsvps!: number;
  @ApiProperty({ type: "integer" }) checkins!: number;
}
export class ManagedEventDto extends EventFieldsDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string;
  @ApiProperty({ type: "integer" }) version!: number;
  @ApiProperty({ type: EventUsageDto }) usage!: EventUsageDto;
}
export class ManagedEventsDto {
  @ApiProperty({ type: [ManagedEventDto] }) items!: ManagedEventDto[];
}
