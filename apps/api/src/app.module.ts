import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { AppLoggingModule } from "./logging/logging.module.js";

@Module({
  imports: [AppLoggingModule, HealthModule],
})
export class AppModule {}
