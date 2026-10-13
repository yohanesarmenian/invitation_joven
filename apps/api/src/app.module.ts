import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CheckinModule } from "./checkin/checkin.module.js";
import { HealthModule } from "./health/health.module.js";
import { ImportsModule } from "./imports/imports.module.js";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { AppLoggingModule } from "./logging/logging.module.js";
import { MessagesModule } from "./messages/messages.module.js";
import { SecurityModule } from "./security/security.module.js";

@Module({
  imports: [
    AppLoggingModule,
    SecurityModule,
    AuthModule,
    AdminModule,
    CheckinModule,
    ImportsModule,
    InvitationsModule,
    MessagesModule,
    HealthModule,
  ],
})
export class AppModule {}
