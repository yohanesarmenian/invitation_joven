import { Global, Module } from "@nestjs/common";
import { AppLogger } from "./app-logger.js";

@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class AppLoggingModule {}
