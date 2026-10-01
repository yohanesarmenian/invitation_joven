import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityModule } from "../security/security.module.js";
import { AdminReadController } from "./admin-read.controller.js";
import { AdminReadService } from "./admin-read.service.js";
import { PublicInvitationBaseUrlService } from "./public-invitation-base-url.service.js";

@Module({
  controllers: [AdminReadController],
  imports: [DatabaseModule, SecurityModule],
  providers: [AdminReadService, PublicInvitationBaseUrlService],
  exports: [AdminReadService, PublicInvitationBaseUrlService],
})
export class AdminModule {}
