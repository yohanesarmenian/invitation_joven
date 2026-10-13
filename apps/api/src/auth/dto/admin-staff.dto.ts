import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type {
  AdminRole,
  AdminUserStatus,
} from "../../generated/prisma/client.js";
import { AdminUserStatus as AdminUserStatusEnum } from "../../generated/prisma/client.js";
import { AdminPageMetadataDto } from "../../admin/dto/admin-read.dto.js";
import { normalizeAdminEmail } from "../admin-credentials.js";
import { validationError } from "../auth-errors.js";

const CREATE_STAFF_FIELDS = new Set(["email"]);
const UPDATE_STAFF_FIELDS = new Set(["status"]);

export type CreateAdminStaffCommand = {
  email: string;
};

export type UpdateAdminStaffCommand = {
  status: AdminUserStatus;
};

export class CreateAdminStaffRequestDto {
  @ApiProperty({ maxLength: 254, type: String })
  email: string;
}

export class UpdateAdminStaffRequestDto {
  @ApiProperty({ enum: ["ACTIVE", "DISABLED"], type: String })
  status: AdminUserStatus;
}

export class AdminStaffDto {
  @ApiProperty({ format: "uuid", type: String })
  id: string;

  @ApiProperty({ type: String })
  email: string;

  @ApiProperty({ enum: ["CHECKIN_STAFF"], type: String })
  role: AdminRole;

  @ApiProperty({ enum: ["ACTIVE", "DISABLED"], type: String })
  status: AdminUserStatus;

  @ApiProperty({ type: Boolean })
  mustChangePassword: boolean;
}

export class AdminStaffListItemDto extends AdminStaffDto {
  @ApiProperty({ format: "date-time", type: String })
  createdAt: string;

  @ApiPropertyOptional({ format: "date-time", nullable: true, type: String })
  lastLoginAt: string | null;
}

export class AdminStaffListResponseDto {
  @ApiProperty({ isArray: true, type: () => AdminStaffListItemDto })
  items: AdminStaffListItemDto[];

  @ApiProperty({ type: () => AdminPageMetadataDto })
  page: AdminPageMetadataDto;
}

export class AdminStaffProvisionResponseDto {
  @ApiProperty({ type: () => AdminStaffDto })
  staff: AdminStaffDto;

  @ApiProperty({ type: String })
  temporaryPassword: string;
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

export function mapCreateAdminStaffRequest(
  body: unknown,
): CreateAdminStaffCommand {
  if (!isRecord(body)) {
    validationError();
  }

  assertNoUnsupportedFields(body, CREATE_STAFF_FIELDS);

  if (!Object.hasOwn(body, "email")) {
    validationError();
  }

  return {
    email: normalizeAdminEmail(body.email),
  };
}

export function mapUpdateAdminStaffRequest(
  body: unknown,
): UpdateAdminStaffCommand {
  if (!isRecord(body)) {
    validationError();
  }

  assertNoUnsupportedFields(body, UPDATE_STAFF_FIELDS);

  if (
    body.status !== AdminUserStatusEnum.ACTIVE &&
    body.status !== AdminUserStatusEnum.DISABLED
  ) {
    validationError();
  }

  return {
    status: body.status,
  };
}
