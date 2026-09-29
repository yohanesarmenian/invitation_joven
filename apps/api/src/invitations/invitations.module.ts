import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityModule } from "../security/security.module.js";
import { PublicInvitationController } from "./public-invitation.controller.js";
import { PublicInvitationService } from "./public-invitation.service.js";
import { PublicRsvpService } from "./public-rsvp.service.js";

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [PublicInvitationController],
  providers: [PublicInvitationService, PublicRsvpService],
  exports: [PublicInvitationService, PublicRsvpService],
})
export class InvitationsModule {}
