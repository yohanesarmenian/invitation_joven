import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { CheckinModule } from "../checkin/checkin.module.js";
import { InvitationsModule } from "../invitations/invitations.module.js";
import { ReceptionController } from "./reception.controller.js";
import { ReceptionService } from "./reception.service.js";
import { ReceptionActionsService } from "./reception-actions.service.js";
import { SecurityModule } from "../security/security.module.js";
@Module({
  imports: [DatabaseModule, CheckinModule, InvitationsModule, SecurityModule],
  controllers: [ReceptionController],
  providers: [ReceptionService, ReceptionActionsService],
})
export class ReceptionModule {}
