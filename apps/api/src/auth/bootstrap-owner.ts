import { PrismaPg } from "@prisma/adapter-pg";
import { getDatabaseUrl } from "../database/database-url.js";
import { AdminRole, AdminUserStatus, PrismaClient } from "../generated/prisma/client.js";
import { normalizeAdminEmail, validateAdminPassword } from "./admin-credentials.js";
import { AdminPasswordService } from "./password.service.js";

const BOOTSTRAP_ADVISORY_LOCK_ID = 8_001_008_001;

export type BootstrapOwnerResult =
  | {
      created: true;
      email: string;
    }
  | {
      created: false;
      reason: "ADMIN_USER_EXISTS";
    };

export async function bootstrapOwner(input: {
  email: unknown;
  password: unknown;
  prisma?: PrismaClient;
  passwordService?: AdminPasswordService;
}): Promise<BootstrapOwnerResult> {
  const email = normalizeAdminEmail(input.email);
  const password = validateAdminPassword(input.password);
  const prisma =
    input.prisma ??
    new PrismaClient({
      adapter: new PrismaPg(getDatabaseUrl()),
    });
  const passwordService = input.passwordService ?? new AdminPasswordService();
  const shouldDisconnect = input.prisma === undefined;

  try {
    const passwordHash = await passwordService.hashPassword(password);

    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK_ID})
      `;

      const existingUsers = await tx.adminUser.count();

      if (existingUsers > 0) {
        return {
          created: false,
          reason: "ADMIN_USER_EXISTS",
        };
      }

      await tx.adminUser.create({
        data: {
          email,
          passwordHash,
          role: AdminRole.OWNER,
          status: AdminUserStatus.ACTIVE,
        },
      });

      return {
        created: true,
        email,
      };
    });
  } finally {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
  }
}
