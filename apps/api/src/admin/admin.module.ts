import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { InvitationsModule } from "../invitations/invitations.module.js";
import { SecurityModule } from "../security/security.module.js";
import {
  AdminInviteeMutationController,
  AdminMessageMutationController,
  AdminMutationController,
} from "./admin-mutation.controller.js";
import { AdminMutationService } from "./admin-mutation.service.js";
import { AdminReadController } from "./admin-read.controller.js";
import { AdminReadService } from "./admin-read.service.js";
import { PublicInvitationBaseUrlService } from "./public-invitation-base-url.service.js";

@Module({
  controllers: [
    AdminInviteeMutationController,
    AdminMessageMutationController,
    AdminMutationController,
    AdminReadController,
  ],
  imports: [DatabaseModule, InvitationsModule, SecurityModule],
  providers: [
    AdminMutationService,
    AdminReadService,
    PublicInvitationBaseUrlService,
  ],
  exports: [AdminReadService, PublicInvitationBaseUrlService],
})
export class AdminModule {}
