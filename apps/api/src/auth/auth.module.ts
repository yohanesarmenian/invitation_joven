import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AdminSecurityGuard } from "../common/admin-security.guard.js";
import { DatabaseModule } from "../database/database.module.js";
import { AdminAuthController } from "./admin-auth.controller.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { AdminOriginService } from "./admin-origin.service.js";
import { AdminSessionGuard, OwnerGuard } from "./admin-session.guard.js";
import { AdminSessionService } from "./admin-session.service.js";
import { AdminCookieService } from "./cookie.service.js";
import { LoginThrottleService } from "./login-throttle.service.js";
import { AdminPasswordService } from "./password.service.js";
import { AdminSessionTokenService } from "./session-token.service.js";

@Module({
  imports: [DatabaseModule],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminCookieService,
    AdminOriginService,
    AdminPasswordService,
    AdminSecurityGuard,
    AdminSessionGuard,
    AdminSessionService,
    AdminSessionTokenService,
    {
      provide: APP_GUARD,
      useExisting: AdminSecurityGuard,
    },
    LoginThrottleService,
    OwnerGuard,
  ],
  exports: [
    AdminCookieService,
    AdminOriginService,
    AdminPasswordService,
    AdminSessionGuard,
    AdminSessionService,
    AdminSessionTokenService,
    AdminSecurityGuard,
    LoginThrottleService,
    OwnerGuard,
  ],
})
export class AuthModule {}
