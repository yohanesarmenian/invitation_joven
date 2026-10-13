import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  AdminRole,
  AdminUserStatus,
  Prisma,
} from "../generated/prisma/client.js";
import {
  buildAdminPageMetadata,
  parseAdminPagination,
} from "../common/admin-query.js";
import { PrismaService } from "../database/prisma.service.js";
import { conflict, notFound, validationError } from "./auth-errors.js";
import { AdminPasswordService } from "./password.service.js";
import { AdminSessionService } from "./admin-session.service.js";
import type {
  AdminStaffDto,
  AdminStaffListItemDto,
  AdminStaffListResponseDto,
  CreateAdminStaffCommand,
  UpdateAdminStaffCommand,
} from "./dto/admin-staff.dto.js";

type StaffRecord = {
  id: string;
  email: string;
  role: AdminRole;
  status: AdminUserStatus;
  mustChangePassword: boolean;
};

type StaffListRecord = StaffRecord & {
  lastLoginAt: Date | null;
  createdAt: Date;
};

const STAFF_LIST_QUERY_FIELDS = new Set(["page", "pageSize", "status"]);

@Injectable()
export class AdminStaffService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminPasswordService)
    private readonly passwordService: AdminPasswordService,
    @Inject(AdminSessionService)
    private readonly sessionService: AdminSessionService,
  ) {}

  async listStaff(
    query: Record<string, unknown>,
  ): Promise<AdminStaffListResponseDto> {
    this.assertAllowedQueryFields(query);
    const page = parseAdminPagination(query);
    const status = this.parseStatusFilter(query.status);
    const where = {
      role: AdminRole.CHECKIN_STAFF,
      status: status ?? undefined,
    } satisfies Prisma.AdminUserWhereInput;
    const [totalItems, staff] = await this.prisma.$transaction([
      this.prisma.adminUser.count({ where }),
      this.prisma.adminUser.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: this.staffListSelect(),
        skip: page.skip,
        take: page.pageSize,
        where,
      }),
    ]);

    return {
      items: staff.map((item) => this.mapStaffListItem(item)),
      page: buildAdminPageMetadata(page, totalItems),
    };
  }

  async createStaff(
    command: CreateAdminStaffCommand,
  ): Promise<{ staff: AdminStaffDto; temporaryPassword: string }> {
    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await this.passwordService.hashPassword(
      temporaryPassword,
    );

    try {
      const staff = await this.prisma.adminUser.create({
        data: {
          email: command.email,
          mustChangePassword: true,
          passwordHash,
          role: AdminRole.CHECKIN_STAFF,
          status: AdminUserStatus.ACTIVE,
        },
        select: this.staffSelect(),
      });

      return {
        staff: this.mapStaff(staff),
        temporaryPassword,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        conflict("Staff email already exists");
      }

      throw error;
    }
  }

  async updateStaffStatus(
    staffId: string,
    command: UpdateAdminStaffCommand,
  ): Promise<AdminStaffDto> {
    const staff = await this.findStaffOrThrow(staffId);
    const updated = await this.prisma.adminUser.update({
      data: { status: command.status },
      where: { id: staff.id },
      select: this.staffSelect(),
    });

    if (command.status === AdminUserStatus.DISABLED) {
      await this.sessionService.revokeSessionsForUser(staff.id);
    }

    return this.mapStaff(updated);
  }

  async resetStaffPassword(
    staffId: string,
  ): Promise<{ staff: AdminStaffDto; temporaryPassword: string }> {
    const staff = await this.findStaffOrThrow(staffId);
    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await this.passwordService.hashPassword(
      temporaryPassword,
    );
    const updated = await this.prisma.adminUser.update({
      data: {
        mustChangePassword: true,
        passwordHash,
      },
      where: { id: staff.id },
      select: this.staffSelect(),
    });
    await this.sessionService.revokeSessionsForUser(staff.id);

    return {
      staff: this.mapStaff(updated),
      temporaryPassword,
    };
  }

  private async findStaffOrThrow(staffId: string): Promise<{ id: string }> {
    const staff = await this.prisma.adminUser.findUnique({
      select: { id: true, role: true },
      where: { id: staffId },
    });

    if (staff === null) {
      notFound();
    }

    if (staff.role !== AdminRole.CHECKIN_STAFF) {
      conflict("Target is not a check-in staff account");
    }

    return staff;
  }

  private generateTemporaryPassword(): string {
    return randomBytes(24).toString("base64url");
  }

  private mapStaff(staff: StaffRecord): AdminStaffDto {
    return {
      email: staff.email,
      id: staff.id,
      mustChangePassword: staff.mustChangePassword,
      role: staff.role,
      status: staff.status,
    };
  }

  private mapStaffListItem(staff: StaffListRecord): AdminStaffListItemDto {
    return {
      ...this.mapStaff(staff),
      createdAt: staff.createdAt.toISOString(),
      lastLoginAt: staff.lastLoginAt?.toISOString() ?? null,
    };
  }

  private staffSelect() {
    return {
      email: true,
      id: true,
      mustChangePassword: true,
      role: true,
      status: true,
    } satisfies Prisma.AdminUserSelect;
  }

  private staffListSelect() {
    return {
      createdAt: true,
      email: true,
      id: true,
      lastLoginAt: true,
      mustChangePassword: true,
      role: true,
      status: true,
    } satisfies Prisma.AdminUserSelect;
  }

  private assertAllowedQueryFields(query: Record<string, unknown>): void {
    if (Object.keys(query).some((key) => !STAFF_LIST_QUERY_FIELDS.has(key))) {
      validationError();
    }
  }

  private parseStatusFilter(value: unknown): AdminUserStatus | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (
      Array.isArray(value) ||
      (value !== AdminUserStatus.ACTIVE && value !== AdminUserStatus.DISABLED)
    ) {
      validationError();
    }

    return value;
  }
}
