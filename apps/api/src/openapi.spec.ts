import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { createOpenApiDocument } from "./openapi.js";

@Module({
  imports: [InvitationsModule],
})
class OpenApiTestModule {}

describe("OpenAPI contract", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.CREDENTIAL_SECRET ??=
      "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    app = await NestFactory.create<NestFastifyApplication>(
      OpenApiTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("documents only the locked public invitation retrieval contract", () => {
    const document = createOpenApiDocument(app);
    const publicInvitationPath =
      document.paths["/api/public/invitations/{publicCredential}"];
    const getOperation = publicInvitationPath?.get;
    const schemas = document.components?.schemas ?? {};

    expect(getOperation).toBeDefined();
    expect(getOperation?.parameters).toContainEqual(
      expect.objectContaining({
        in: "path",
        name: "publicCredential",
        required: true,
        schema: expect.objectContaining({
          maxLength: 43,
          minLength: 43,
          pattern: "^[A-Za-z0-9_-]{43}$",
          type: "string",
        }),
      }),
    );
    expect(getOperation?.responses).toHaveProperty("200");
    expect(getOperation?.responses).toHaveProperty("404");
    expect(schemas).toHaveProperty("PublicInvitationResponseDto");
    expect(schemas).toHaveProperty("ApiErrorEnvelopeDto");
    expect(JSON.stringify(schemas)).not.toContain("publicTokenHash");
    expect(JSON.stringify(schemas)).not.toContain("publicTokenVersion");
    expect(JSON.stringify(schemas)).not.toContain("openCount");

    expect(schemas.PublicInvitationDto).toMatchObject({
      properties: expect.objectContaining({
        displayName: expect.objectContaining({ type: "string" }),
        rsvp: expect.objectContaining({ nullable: true }),
        rsvpDeadlineAt: expect.objectContaining({
          format: "date-time",
          nullable: true,
          type: "string",
        }),
      }),
    });
  });
});
