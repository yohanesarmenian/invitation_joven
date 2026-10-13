import { ApiProperty } from "@nestjs/swagger";
import type { AdminRole } from "../../generated/prisma/client.js";
import { normalizeAdminEmail, validateAdminPassword } from "../admin-credentials.js";
import { validationError } from "../auth-errors.js";

const LOGIN_REQUEST_FIELDS = new Set(["email", "password"]);
const CHANGE_PASSWORD_REQUEST_FIELDS = new Set([
  "currentPassword",
  "newPassword",
]);

export type AdminLoginCommand = {
  email: string;
  password: string;
};

export type AdminChangePasswordCommand = {
  currentPassword: string;
  newPassword: string;
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

  @ApiProperty({ enum: ["OWNER", "CHECKIN_STAFF"], type: String })
  role: AdminRole;

  @ApiProperty({ type: Boolean })
  mustChangePassword: boolean;
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

export class AdminChangePasswordRequestDto {
  @ApiProperty({ maxLength: 128, minLength: 15, type: String })
  currentPassword: string;

  @ApiProperty({ maxLength: 128, minLength: 15, type: String })
  newPassword: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoUnsupportedFields(
  value: Record<string, unknown>,
  allowedFields: Set<string>,
): void {
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    validationError();
  }
}

export function mapAdminLoginRequest(body: unknown): AdminLoginCommand {
  if (!isRecord(body)) {
    validationError();
  }

  assertNoUnsupportedFields(body, LOGIN_REQUEST_FIELDS);

  if (!Object.hasOwn(body, "email") || !Object.hasOwn(body, "password")) {
    validationError();
  }

  return {
    email: normalizeAdminEmail(body.email),
    password: validateAdminPassword(body.password),
  };
}

export function mapAdminChangePasswordRequest(
  body: unknown,
): AdminChangePasswordCommand {
  if (!isRecord(body)) {
    validationError();
  }

  assertNoUnsupportedFields(body, CHANGE_PASSWORD_REQUEST_FIELDS);

  if (
    !Object.hasOwn(body, "currentPassword") ||
    !Object.hasOwn(body, "newPassword")
  ) {
    validationError();
  }

  return {
    currentPassword: validateAdminPassword(body.currentPassword),
    newPassword: validateAdminPassword(body.newPassword),
  };
}
