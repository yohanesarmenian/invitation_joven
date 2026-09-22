import type { OpenAPIObject } from "@nestjs/swagger";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

export function createOpenApiDocument(
  app: NestFastifyApplication,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Wedding Invitation API")
    .setDescription("Backend API contract for the wedding invitation system.")
    .setVersion("0.1.0")
    .build();

  return SwaggerModule.createDocument(app, config);
}
