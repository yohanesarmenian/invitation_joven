import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { configureApp } from "./app.setup.js";
import { getListenConfig } from "./runtime/listen-config.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  const { port, host } = getListenConfig();

  configureApp(app);

  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap();
