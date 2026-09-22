import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { AppLoggingModule } from "./logging/logging.module.js";
import { SecurityModule } from "./security/security.module.js";

@Module({
  imports: [AppLoggingModule, SecurityModule, HealthModule],
})
export class AppModule {}
