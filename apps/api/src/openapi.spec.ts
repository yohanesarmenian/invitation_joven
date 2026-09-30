import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { MessagesModule } from "./messages/messages.module.js";
import { createOpenApiDocument } from "./openapi.js";

@Module({
  imports: [InvitationsModule, MessagesModule],
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

  it("documents the locked public invitation and RSVP contracts", () => {
    const document = createOpenApiDocument(app);
    const publicInvitationPath =
      document.paths["/api/public/invitations/{publicCredential}"];
    const getOperation = publicInvitationPath?.get;
    const publicRsvpPath =
      document.paths["/api/public/invitations/{publicCredential}/rsvp"];
    const getRsvpOperation = publicRsvpPath?.get;
    const putRsvpOperation = publicRsvpPath?.put;
    const publicGuestMessagePath =
      document.paths["/api/public/invitations/{publicCredential}/messages"];
    const postMessageOperation = publicGuestMessagePath?.post;
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
    expect(getRsvpOperation).toBeDefined();
    expect(getRsvpOperation?.responses).toHaveProperty("200");
    expect(getRsvpOperation?.responses).toHaveProperty("404");
    expect(putRsvpOperation).toBeDefined();
    expect(putRsvpOperation?.requestBody).toBeDefined();
    expect(putRsvpOperation?.responses).toHaveProperty("200");
    expect(putRsvpOperation?.responses).toHaveProperty("400");
    expect(putRsvpOperation?.responses).toHaveProperty("404");
    expect(putRsvpOperation?.responses).toHaveProperty("409");
    expect(putRsvpOperation?.responses).toHaveProperty("422");
    expect(postMessageOperation).toBeDefined();
    expect(postMessageOperation?.requestBody).toBeDefined();
    expect(postMessageOperation?.responses).toHaveProperty("201");
    expect(postMessageOperation?.responses).toHaveProperty("400");
    expect(postMessageOperation?.responses).toHaveProperty("404");
    expect(publicGuestMessagePath?.get).toBeUndefined();
    expect(publicGuestMessagePath?.put).toBeUndefined();
    expect(publicGuestMessagePath?.patch).toBeUndefined();
    expect(publicGuestMessagePath?.delete).toBeUndefined();
    expect(schemas).toHaveProperty("PublicInvitationResponseDto");
    expect(schemas).toHaveProperty("SubmitPublicRsvpRequestDto");
    expect(schemas).toHaveProperty("PublicRsvpMutationResponseDto");
    expect(schemas).toHaveProperty("PublicRsvpReadResponseDto");
    expect(schemas).toHaveProperty("SubmitPublicGuestMessageRequestDto");
    expect(schemas).toHaveProperty("PublicGuestMessageResponseDto");
    expect(schemas).toHaveProperty("ApiErrorEnvelopeDto");
    expect(JSON.stringify(schemas)).not.toContain("publicTokenHash");
    expect(JSON.stringify(schemas)).not.toContain("publicTokenVersion");
    expect(JSON.stringify(schemas)).not.toContain("openCount");
    expect(JSON.stringify(schemas)).not.toContain("tokenHash");
    expect(JSON.stringify(schemas)).not.toContain("credentialVersion");

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
    expect(schemas.SubmitPublicRsvpRequestDto).toMatchObject({
      properties: expect.objectContaining({
        expectedVersion: expect.objectContaining({ nullable: true }),
        status: expect.objectContaining({
          enum: ["ACCEPTED", "DECLINED"],
        }),
      }),
    });
    expect(schemas.PublicRsvpStateDto).toMatchObject({
      properties: expect.objectContaining({
        attendees: expect.objectContaining({ type: "array" }),
        dietaryNotes: expect.objectContaining({ nullable: true }),
        eventSelections: expect.objectContaining({ type: "array" }),
        status: expect.objectContaining({
          enum: ["PENDING", "ACCEPTED", "DECLINED"],
        }),
      }),
    });
    expect(schemas.PublicCheckinPassDto).toMatchObject({
      properties: {
        issuedAt: expect.objectContaining({
          format: "date-time",
          type: "string",
        }),
        qrPayload: expect.objectContaining({
          maxLength: 43,
          minLength: 43,
          pattern: "^[A-Za-z0-9_-]{43}$",
          type: "string",
        }),
        status: expect.objectContaining({
          enum: ["ACTIVE"],
          type: "string",
        }),
      },
      required: expect.arrayContaining(["status", "issuedAt", "qrPayload"]),
    });
    expect(schemas.SubmitPublicGuestMessageRequestDto).toMatchObject({
      properties: {
        authorName: expect.objectContaining({
          maxLength: 100,
          nullable: true,
          type: "string",
        }),
        message: expect.objectContaining({
          maxLength: 1000,
          type: "string",
        }),
      },
      required: ["message"],
    });
    expect(schemas.PublicGuestMessageDto).toMatchObject({
      properties: {
        createdAt: expect.objectContaining({
          format: "date-time",
          type: "string",
        }),
      },
      required: ["createdAt"],
    });
    expect(schemas.PublicGuestMessageResponseDto).toMatchObject({
      properties: {
        message: expect.objectContaining({
          $ref: "#/components/schemas/PublicGuestMessageDto",
        }),
      },
      required: ["message"],
    });
    expect(JSON.stringify(schemas.PublicGuestMessageResponseDto)).not.toContain(
      "id",
    );
    expect(JSON.stringify(schemas.PublicGuestMessageResponseDto)).not.toContain(
      "invitationId",
    );
    expect(JSON.stringify(schemas.PublicGuestMessageResponseDto)).not.toContain(
      "isHidden",
    );
  });
});
