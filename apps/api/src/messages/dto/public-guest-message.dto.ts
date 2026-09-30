import { BadRequestException } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { SubmitPublicGuestMessageCommand } from "../public-guest-message.service.js";

const MESSAGE_MAX_CODE_POINTS = 1000;
const AUTHOR_NAME_MAX_CODE_POINTS = 100;
const TOP_LEVEL_REQUEST_FIELDS = new Set(["authorName", "message"]);

export class SubmitPublicGuestMessageRequestDto {
  @ApiPropertyOptional({ maxLength: 100, nullable: true, type: String })
  authorName?: string | null;

  @ApiProperty({ maxLength: 1000, type: String })
  message: string;
}

export class PublicGuestMessageDto {
  @ApiProperty({ format: "date-time", type: String })
  createdAt: string;
}

export class PublicGuestMessageResponseDto {
  @ApiProperty({ type: () => PublicGuestMessageDto })
  message: PublicGuestMessageDto;
}

function validationError(): never {
  throw new BadRequestException({
    code: "VALIDATION_ERROR",
    details: null,
    message: "Validation error",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countCodePoints(value: string): number {
  return [...value].length;
}

function assertNoUnsupportedTopLevelFields(value: Record<string, unknown>): void {
  if (Object.keys(value).some((key) => !TOP_LEVEL_REQUEST_FIELDS.has(key))) {
    validationError();
  }
}

function parseMessage(value: unknown): string {
  if (typeof value !== "string") {
    validationError();
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    countCodePoints(normalized) > MESSAGE_MAX_CODE_POINTS
  ) {
    validationError();
  }

  return normalized;
}

function parseAuthorName(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    validationError();
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  if (countCodePoints(normalized) > AUTHOR_NAME_MAX_CODE_POINTS) {
    validationError();
  }

  return normalized;
}

export function mapSubmitPublicGuestMessageRequest(
  publicCredential: string,
  body: unknown,
): SubmitPublicGuestMessageCommand {
  if (!isRecord(body)) {
    validationError();
  }

  assertNoUnsupportedTopLevelFields(body);

  if (!Object.hasOwn(body, "message")) {
    validationError();
  }

  return {
    authorName: parseAuthorName(body.authorName),
    message: parseMessage(body.message),
    publicCredential,
  };
}
