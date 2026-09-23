import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { AppLoggingModule } from "./logging/logging.module.js";
import { SecurityModule } from "./security/security.module.js";

@Module({
  imports: [AppLoggingModule, SecurityModule, InvitationsModule, HealthModule],
})
export class AppModule {}
