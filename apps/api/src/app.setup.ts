import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import multipart from "@fastify/multipart";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { AppLogger } from "./logging/app-logger.js";
import { registerRequestLogging } from "./logging/request-logging.js";

const MAX_IMPORT_UPLOAD_BYTES = 5 * 1024 * 1024;

export function configureApp(app: NestFastifyApplication) {
  if (typeof app.register === "function") {
    app.register(multipart, {
      limits: {
        fileSize: MAX_IMPORT_UPLOAD_BYTES,
        files: 2,
      },
      throwFileSizeLimit: true,
    });
  }
  const logger = app.get(AppLogger);
  app.useLogger(logger);
  registerRequestLogging(app, logger);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
}
