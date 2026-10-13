import { Inject, Injectable, Optional } from "@nestjs/common";
import { AdminRole, AdminUserStatus } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { invalidCredentials } from "./auth-errors.js";
import type {
  AdminChangePasswordCommand,
  AdminLoginCommand,
} from "./dto/admin-auth.dto.js";
import { LoginThrottleService, ADMIN_AUTH_CLOCK, type AdminAuthClock } from "./login-throttle.service.js";
import { AdminPasswordService } from "./password.service.js";
import { AdminSessionService } from "./admin-session.service.js";
import { AdminSessionTokenService } from "./session-token.service.js";

export type AdminAuthResult = {
  sessionToken: string;
  csrfToken: string;
  response: {
    user: {
      id: string;
      email: string;
      role: AdminRole;
      mustChangePassword: boolean;
    };
    session: {
      expiresAt: string;
    };
    csrfToken: string;
  };
};

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminPasswordService)
    private readonly passwordService: AdminPasswordService,
    @Inject(AdminSessionTokenService)
    private readonly tokenService: AdminSessionTokenService,
    @Inject(LoginThrottleService)
    private readonly throttleService: LoginThrottleService,
    @Inject(AdminSessionService)
    private readonly sessionService: AdminSessionService,
    @Optional()
    @Inject(ADMIN_AUTH_CLOCK)
    private readonly currentTime: AdminAuthClock = () => new Date(),
  ) {}

  async login(command: AdminLoginCommand): Promise<AdminAuthResult> {
    this.throttleService.assertAllowed(command.email);
    const user = await this.prisma.adminUser.findUnique({
      where: { email: command.email },
      select: {
        id: true,
        email: true,
        mustChangePassword: true,
        passwordHash: true,
        role: true,
        status: true,
      },
    });
    const authenticatable = user?.status === AdminUserStatus.ACTIVE;
    const passwordMatches =
      user === null
        ? await this.passwordService.verifyAgainstDummy(command.password)
        : await this.passwordService.verifyPassword(
            user.passwordHash,
            command.password,
          );

    if (!authenticatable || !passwordMatches) {
      this.throttleService.recordFailure(command.email);
      invalidCredentials();
    }

    const now = this.currentTime();
    const expiresAt = new Date(now.getTime() + this.sessionService.getAbsoluteSessionMs());
    const tokens = this.tokenService.generateSessionTokens();

    await this.prisma.$transaction(async (tx) => {
      await tx.adminSession.create({
        data: {
          adminUserId: user.id,
          createdAt: now,
          csrfTokenHash: tokens.csrfTokenHash,
          expiresAt,
          sessionTokenHash: tokens.sessionTokenHash,
        },
      });
      await tx.adminUser.update({
        data: { lastLoginAt: now },
        where: { id: user.id },
      });
    });
    this.throttleService.recordSuccess(command.email);
    void this.sessionService.cleanupExpiredSessions();

    return {
      csrfToken: tokens.csrfToken,
      sessionToken: tokens.sessionToken,
      response: {
        csrfToken: tokens.csrfToken,
        session: {
          expiresAt: expiresAt.toISOString(),
        },
        user: {
          email: user.email,
          id: user.id,
          mustChangePassword: user.mustChangePassword,
          role: user.role,
        },
      },
    };
  }

  async changePassword(
    adminUserId: string,
    currentSessionId: string,
    command: AdminChangePasswordCommand,
  ): Promise<void> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: {
        id: true,
        passwordHash: true,
        status: true,
      },
    });

    const passwordMatches =
      user === null
        ? await this.passwordService.verifyAgainstDummy(command.currentPassword)
        : await this.passwordService.verifyPassword(
            user.passwordHash,
            command.currentPassword,
          );

    if (user?.status !== AdminUserStatus.ACTIVE || !passwordMatches) {
      invalidCredentials();
    }

    const passwordHash = await this.passwordService.hashPassword(
      command.newPassword,
    );

    await this.prisma.adminUser.update({
      data: {
        mustChangePassword: false,
        passwordHash,
      },
      where: { id: user.id },
    });
    await this.sessionService.revokeSessionsForUser(user.id, {
      exceptSessionId: currentSessionId,
    });
  }
}
