import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { RsvpPolicyController } from "./rsvp-policy.controller.js";
import { CateringController } from "./catering.controller.js";
import { CateringService } from "./catering.service.js";
@Module({
  imports: [DatabaseModule],
  controllers: [ReportsController, RsvpPolicyController, CateringController],
  providers: [ReportsService, CateringService],
})
export class ReportsModule {}
