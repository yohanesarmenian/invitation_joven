import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { createOpenApiDocument } from "./openapi.js";

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
  { logger: false },
);
const outputPath = resolve(process.cwd(), "openapi.json");
const document = createOpenApiDocument(app);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
await app.close();
