import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityModule } from "../security/security.module.js";
import {
  AdminEventContentController,
  PublicEventContentController,
} from "./event-content.controller.js";
import { EventContentService } from "./event-content.service.js";
@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [AdminEventContentController, PublicEventContentController],
  providers: [EventContentService],
})
export class EventContentModule {}
