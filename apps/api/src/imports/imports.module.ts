import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { SecurityModule } from "../security/security.module.js";
import { GuestImportController } from "./guest-import.controller.js";
import { GuestImportService } from "./guest-import.service.js";

@Module({
  controllers: [GuestImportController],
  imports: [DatabaseModule, SecurityModule],
  providers: [GuestImportService],
})
export class ImportsModule {}
