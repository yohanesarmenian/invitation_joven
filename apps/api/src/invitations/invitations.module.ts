import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityModule } from "../security/security.module.js";
import { PublicInvitationService } from "./public-invitation.service.js";

@Module({
  imports: [DatabaseModule, SecurityModule],
  providers: [PublicInvitationService],
  exports: [PublicInvitationService],
})
export class InvitationsModule {}
