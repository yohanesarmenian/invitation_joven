import { ApiProperty } from "@nestjs/swagger";

export class ApiErrorDto {
  @ApiProperty({ type: String })
  code: string;

  @ApiProperty({ type: String })
  message: string;

  @ApiProperty({
    additionalProperties: true,
    nullable: true,
    type: Object,
  })
  details: Record<string, unknown> | null;
}

export class ApiErrorEnvelopeDto {
  @ApiProperty({ type: () => ApiErrorDto })
  error: ApiErrorDto;

  @ApiProperty({ type: String })
  requestId: string;

  @ApiProperty({ format: "date-time", type: String })
  timestamp: string;
}
