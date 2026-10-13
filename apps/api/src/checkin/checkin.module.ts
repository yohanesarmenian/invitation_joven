import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityModule } from "../security/security.module.js";
import { CheckinController } from "./checkin.controller.js";
import { CheckinService } from "./checkin.service.js";

@Module({
  controllers: [CheckinController],
  imports: [DatabaseModule, SecurityModule],
  providers: [CheckinService],
})
export class CheckinModule {}
