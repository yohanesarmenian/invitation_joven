import { ApiProperty } from "@nestjs/swagger";

export class EventParkingDto {
  @ApiProperty({ type: String, maxLength: 120 }) title: string;
  @ApiProperty({ type: [String], maxItems: 12 }) instructions: string[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) mapAssetId:
    string | null;
  @ApiProperty({ type: String, maxLength: 300 }) mapAlt: string;
  @ApiProperty({ type: String, format: "uuid", nullable: true }) pdfAssetId:
    string | null;
  @ApiProperty({ type: String, nullable: true, maxLength: 2048 })
  googleMapsUrl: string | null;
}
export class EventRundownItemDto {
  @ApiProperty({
    type: String,
    description: "ISO 8601 instant with explicit offset; may be blank in draft",
  })
  startsAt: string;
  @ApiProperty({ type: String, maxLength: 120 }) title: string;
  @ApiProperty({ type: String, maxLength: 500 }) description: string;
}
export class EventRundownDto {
  @ApiProperty({ type: String, maxLength: 120 }) title: string;
  @ApiProperty({ type: [EventRundownItemDto], maxItems: 30 })
  items: EventRundownItemDto[];
}
export class EventVenueBodyDto {
  @ApiProperty({ type: EventParkingDto, nullable: true })
  parking: EventParkingDto | null;
  @ApiProperty({ type: EventRundownDto, nullable: true })
  rundown: EventRundownDto | null;
}
export class EventContentVersionDto {
  @ApiProperty({ minimum: 0, type: Number }) expectedVersion: number;
}
export class SaveEventContentDto extends EventContentVersionDto {
  @ApiProperty({ type: EventVenueBodyDto }) content: EventVenueBodyDto;
}
export class EventContentAssetDto {
  @ApiProperty({ type: String, format: "uuid" }) id: string;
  @ApiProperty({ type: String, enum: ["IMAGE", "PDF"] }) kind: "IMAGE" | "PDF";
  @ApiProperty({ type: String, enum: ["image/png", "application/pdf"] })
  mimeType: "image/png" | "application/pdf";
  @ApiProperty({ type: Number }) byteSize: number;
  @ApiProperty({ type: Boolean }) usedByDraft: boolean;
  @ApiProperty({ type: Boolean }) usedByPublished: boolean;
}
export class AdminEventContentDto {
  @ApiProperty({ type: String, format: "uuid" }) eventId: string;
  @ApiProperty({ type: String }) eventName: string;
  @ApiProperty({ type: Number, minimum: 0 }) version: number;
  @ApiProperty({ type: EventVenueBodyDto }) draft: EventVenueBodyDto;
  @ApiProperty({ type: EventVenueBodyDto, nullable: true })
  published: EventVenueBodyDto | null;
  @ApiProperty({ type: String, nullable: true, format: "date-time" })
  publishedAt: string | null;
  @ApiProperty({ type: [EventContentAssetDto] }) assets: EventContentAssetDto[];
}
export class PublicEventContentItemDto {
  @ApiProperty({ type: String, format: "uuid" }) eventId: string;
  @ApiProperty({ type: String }) eventName: string;
  @ApiProperty({ type: EventVenueBodyDto }) content: EventVenueBodyDto;
}
export class PublicEventContentDto {
  @ApiProperty({ type: [PublicEventContentItemDto] })
  items: PublicEventContentItemDto[];
}
