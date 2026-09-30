import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AdminRole, AdminUserStatus } from "../generated/prisma/client.js";
import { AdminRole as AdminRoleEnum, AdminUserStatus as AdminUserStatusEnum } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { csrfInvalid, forbidden, unauthenticated } from "./auth-errors.js";
import { AdminCookieService } from "./cookie.service.js";
import { ADMIN_AUTH_CLOCK, type AdminAuthClock } from "./login-throttle.service.js";
import { AdminSessionTokenService } from "./session-token.service.js";

const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const LAST_SEEN_UPDATE_THRESHOLD_MS = 5 * 60 * 1000;
const CLEANUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthenticatedAdminContext = {
  rawSessionTokenBytes: Buffer;
  csrfToken: string;
  user: {
    id: string;
    email: string;
    role: AdminRole;
    status: AdminUserStatus;
  };
  session: {
    id: string;
    csrfTokenHash: string | null;
    expiresAt: Date;
  };
};

@Injectable()
export class AdminSessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminCookieService) private readonly cookieService: AdminCookieService,
    @Inject(AdminSessionTokenService)
    private readonly tokenService: AdminSessionTokenService,
    @Optional()
    @Inject(ADMIN_AUTH_CLOCK)
    private readonly currentTime: AdminAuthClock = () => new Date(),
  ) {}

  getAbsoluteSessionMs(): number {
    return ABSOLUTE_SESSION_MS;
  }

  async authenticate(cookieHeader: string | string[] | undefined): Promise<AuthenticatedAdminContext> {
    const sessionToken = this.cookieService.parseSessionCookie(cookieHeader);

    if (sessionToken === null) {
      unauthenticated();
    }

    const rawSessionTokenBytes = this.tokenService.parseSessionToken(sessionToken);

    if (rawSessionTokenBytes === null) {
      unauthenticated();
    }

    const sessionTokenHash =
      this.tokenService.hashSessionTokenBytes(rawSessionTokenBytes);
    const session = await this.prisma.adminSession.findUnique({
      where: { sessionTokenHash },
      select: {
        id: true,
        csrfTokenHash: true,
        createdAt: true,
        expiresAt: true,
        lastSeenAt: true,
        revokedAt: true,
        adminUser: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (session === null) {
      unauthenticated();
    }

    const now = this.currentTime();
    const effectiveActivity = session.lastSeenAt ?? session.createdAt;

    if (
      session.adminUser.status !== AdminUserStatusEnum.ACTIVE ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now.getTime() ||
      now.getTime() - effectiveActivity.getTime() >= IDLE_TIMEOUT_MS
    ) {
      unauthenticated();
    }

    if (
      now.getTime() - effectiveActivity.getTime() >=
      LAST_SEEN_UPDATE_THRESHOLD_MS
    ) {
      await this.prisma.adminSession.updateMany({
        data: { lastSeenAt: now },
        where: {
          id: session.id,
          revokedAt: null,
        },
      });
    }

    return {
      rawSessionTokenBytes,
      csrfToken: this.tokenService.deriveCsrfToken(rawSessionTokenBytes),
      user: session.adminUser,
      session: {
        id: session.id,
        csrfTokenHash: session.csrfTokenHash,
        expiresAt: session.expiresAt,
      },
    };
  }

  assertOwner(context: AuthenticatedAdminContext): void {
    if (context.user.role !== AdminRoleEnum.OWNER) {
      forbidden();
    }
  }

  assertCsrf(context: AuthenticatedAdminContext, csrfToken: string | undefined): void {
    if (
      typeof csrfToken !== "string" ||
      !this.tokenService.csrfTokenHashMatches(
        context.session.csrfTokenHash,
        csrfToken,
      )
    ) {
      csrfInvalid();
    }
  }

  async revokeCurrentSession(sessionId: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      data: { revokedAt: this.currentTime() },
      where: {
        id: sessionId,
        revokedAt: null,
      },
    });
  }

  async cleanupExpiredSessions(): Promise<void> {
    const cutoff = new Date(this.currentTime().getTime() - CLEANUP_RETENTION_MS);

    await this.prisma.adminSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: cutoff } },
          { revokedAt: { lt: cutoff } },
        ],
      },
    });
  }
}
