import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { AppLogger } from "./logging/app-logger.js";
import { registerRequestLogging } from "./logging/request-logging.js";

export function configureApp(app: NestFastifyApplication) {
  const logger = app.get(AppLogger);
  app.useLogger(logger);
  registerRequestLogging(app, logger);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
