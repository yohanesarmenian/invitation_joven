import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AdminPageMetadataDto } from "../admin/dto/admin-read.dto.js";
export const reportKinds = ["RSVP", "CHECKIN", "NOT_ARRIVED"] as const;
export type ReportKind = (typeof reportKinds)[number];
export class ReportFilterDto {
  @ApiPropertyOptional({ enum: ["exclude", "include"], default: "exclude" })
  archived?: string;
  @ApiPropertyOptional({ format: "uuid", type: String }) eventId?: string;
}
export class ReportListQueryDto extends ReportFilterDto {
  @ApiPropertyOptional({ enum: reportKinds, default: "RSVP" }) kind?: string;
  @ApiPropertyOptional({ minimum: 1, type: Number }) page?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, type: Number })
  pageSize?: number;
}
export class ReportExportQueryDto extends ReportFilterDto {
  @ApiPropertyOptional({
    enum: ["SUMMARY", ...reportKinds],
    default: "SUMMARY",
  })
  kind?: string;
}
export class ReportEventDto {
  @ApiProperty({ format: "uuid", type: String }) id: string;
  @ApiProperty({ type: String }) name: string;
  @ApiProperty({ type: Boolean }) isActive: boolean;
  @ApiProperty({ minimum: 0, type: Number }) expectedAttendeeCount: number;
  @ApiProperty({ minimum: 0, type: Number }) expectedHouseholds: number;
  @ApiProperty({ minimum: 0, type: Number }) actualAttendeeCount: number;
  @ApiProperty({ minimum: 0, type: Number }) checkedInHouseholds: number;
  @ApiProperty({ minimum: 0, type: Number }) notArrivedHouseholds: number;
}
export class ReportSummaryDto {
  @ApiProperty({ format: "date-time", type: String }) generatedAt: string;
  @ApiProperty({ enum: ["exclude", "include"] }) archived:
    "exclude" | "include";
  @ApiProperty({ type: () => [ReportEventDto] }) events: ReportEventDto[];
}
export class ReportRowDto {
  @ApiProperty({ format: "uuid", type: String }) invitationId: string;
  @ApiProperty({ type: String }) displayName: string;
  @ApiProperty({ enum: ["ACTIVE", "ARCHIVED"] }) invitationStatus: string;
  @ApiProperty({ enum: ["PENDING", "ACCEPTED", "DECLINED"] })
  rsvpStatus: string;
  @ApiProperty({ nullable: true, type: String }) dietaryNotes: string | null;
  @ApiProperty({ minimum: 0, type: Number }) rsvpHouseholdSize: number;
  @ApiProperty({ nullable: true, format: "uuid", type: String }) eventId:
    string | null;
  @ApiProperty({ nullable: true, type: String }) eventName: string | null;
  @ApiProperty({ nullable: true, minimum: 0, type: Number })
  expectedAttendeeCount: number | null;
  @ApiProperty({ nullable: true, minimum: 1, type: Number })
  actualAttendeeCount: number | null;
  @ApiProperty({ nullable: true, format: "date-time", type: String })
  checkedInAt: string | null;
  @ApiProperty({ nullable: true, enum: ["QR", "MANUAL"], type: String })
  method: string | null;
  @ApiProperty({ nullable: true, type: String }) operatorEmail: string | null;
}
export class ReportListDto {
  @ApiProperty({ format: "date-time", type: String }) generatedAt: string;
  @ApiProperty({ type: () => [ReportRowDto] }) items: ReportRowDto[];
  @ApiProperty({ type: () => AdminPageMetadataDto }) page: AdminPageMetadataDto;
}
