import { ApiProperty } from "@nestjs/swagger";
import type { AdminRole } from "../../generated/prisma/client.js";
import { normalizeAdminEmail, validateAdminPassword } from "../admin-credentials.js";
import { validationError } from "../auth-errors.js";

const LOGIN_REQUEST_FIELDS = new Set(["email", "password"]);

export type AdminLoginCommand = {
  email: string;
  password: string;
};

export class AdminLoginRequestDto {
  @ApiProperty({ maxLength: 254, type: String })
  email: string;

  @ApiProperty({ maxLength: 128, minLength: 15, type: String })
  password: string;
}

export class AdminAuthUserDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  email: string;

  @ApiProperty({ enum: ["OWNER"], type: String })
  role: AdminRole;
}

export class AdminAuthSessionDto {
  @ApiProperty({ format: "date-time", type: String })
  expiresAt: string;
}

export class AdminAuthResponseDto {
  @ApiProperty({ type: () => AdminAuthUserDto })
  user: AdminAuthUserDto;

  @ApiProperty({ type: () => AdminAuthSessionDto })
  session: AdminAuthSessionDto;

  @ApiProperty({ type: String })
  csrfToken: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoUnsupportedFields(value: Record<string, unknown>): void {
  if (Object.keys(value).some((key) => !LOGIN_REQUEST_FIELDS.has(key))) {
    validationError();
  }
}

export function mapAdminLoginRequest(body: unknown): AdminLoginCommand {
  if (!isRecord(body)) {
    validationError();
  }

  assertNoUnsupportedFields(body);

  if (!Object.hasOwn(body, "email") || !Object.hasOwn(body, "password")) {
    validationError();
  }

  return {
    email: normalizeAdminEmail(body.email),
    password: validateAdminPassword(body.password),
  };
}
