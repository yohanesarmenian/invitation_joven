import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { CheckinModule } from "../checkin/checkin.module.js";
import { InvitationsModule } from "../invitations/invitations.module.js";
import { ReceptionController } from "./reception.controller.js";
import { ReceptionService } from "./reception.service.js";
@Module({
  imports: [DatabaseModule, CheckinModule, InvitationsModule],
  controllers: [ReceptionController],
  providers: [ReceptionService],
})
export class ReceptionModule {}
