import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityModule } from "../security/security.module.js";
import { PublicGuestMessageController } from "./public-guest-message.controller.js";
import { PublicGuestMessageService } from "./public-guest-message.service.js";

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [PublicGuestMessageController],
  providers: [PublicGuestMessageService],
  exports: [PublicGuestMessageService],
})
export class MessagesModule {}
