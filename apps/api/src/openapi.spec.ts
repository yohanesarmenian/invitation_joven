import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminModule } from "./admin/admin.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { MessagesModule } from "./messages/messages.module.js";
import { createOpenApiDocument } from "./openapi.js";

@Module({
  imports: [AuthModule, AdminModule, InvitationsModule, MessagesModule],
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
    const adminLoginPath = document.paths["/api/admin/auth/login"];
    const adminMePath = document.paths["/api/admin/auth/me"];
    const adminLogoutPath = document.paths["/api/admin/auth/logout"];
    const adminDashboardPath = document.paths["/api/admin/dashboard"];
    const adminEventsPath = document.paths["/api/admin/events"];
    const adminInvitationsPath = document.paths["/api/admin/invitations"];
    const adminInvitationDetailPath =
      document.paths["/api/admin/invitations/{invitationId}"];
    const adminInvitationPublicUrlPath =
      document.paths["/api/admin/invitations/{invitationId}/public-url"];
    const adminInvitationArchivePath =
      document.paths["/api/admin/invitations/{invitationId}/archive"];
    const adminInvitationRegenerateTokenPath =
      document.paths[
        "/api/admin/invitations/{invitationId}/regenerate-token"
      ];
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
    expect(adminLoginPath?.post).toBeDefined();
    expect(adminLoginPath?.post?.requestBody).toBeDefined();
    expect(adminLoginPath?.post?.responses).toHaveProperty("200");
    expect(adminLoginPath?.post?.responses).toHaveProperty("400");
    expect(adminLoginPath?.post?.responses).toHaveProperty("401");
    expect(adminLoginPath?.post?.responses).toHaveProperty("403");
    expect(adminLoginPath?.post?.responses).toHaveProperty("429");
    expect(adminMePath?.get).toBeDefined();
    expect(adminMePath?.get?.responses).toHaveProperty("200");
    expect(adminMePath?.get?.responses).toHaveProperty("401");
    expect(adminLogoutPath?.post).toBeDefined();
    expect(adminLogoutPath?.post?.responses).toHaveProperty("204");
    expect(adminLogoutPath?.post?.responses).toHaveProperty("401");
    expect(adminLogoutPath?.post?.responses).toHaveProperty("403");
    expect(adminDashboardPath?.get).toBeDefined();
    expect(adminDashboardPath?.get?.responses).toHaveProperty("200");
    expect(adminDashboardPath?.post).toBeUndefined();
    expect(adminEventsPath?.get).toBeDefined();
    expect(adminEventsPath?.get?.responses).toHaveProperty("200");
    expect(adminEventsPath?.post).toBeUndefined();
    expect(adminInvitationsPath?.get).toBeDefined();
    expect(adminInvitationsPath?.get?.responses).toHaveProperty("200");
    expect(adminInvitationsPath?.post).toBeDefined();
    expect(adminInvitationsPath?.post?.requestBody).toBeDefined();
    expect(adminInvitationsPath?.post?.responses).toHaveProperty("201");
    expect(adminInvitationsPath?.post?.responses).toHaveProperty("400");
    expect(adminInvitationsPath?.post?.responses).toHaveProperty("401");
    expect(adminInvitationsPath?.post?.responses).toHaveProperty("403");
    expect(adminInvitationsPath?.post?.responses).toHaveProperty("409");
    expect(adminInvitationDetailPath?.get).toBeDefined();
    expect(adminInvitationDetailPath?.get?.responses).toHaveProperty("200");
    expect(adminInvitationDetailPath?.patch).toBeDefined();
    expect(adminInvitationDetailPath?.patch?.requestBody).toBeDefined();
    expect(adminInvitationDetailPath?.patch?.responses).toHaveProperty("200");
    expect(adminInvitationDetailPath?.patch?.responses).toHaveProperty("400");
    expect(adminInvitationDetailPath?.patch?.responses).toHaveProperty("401");
    expect(adminInvitationDetailPath?.patch?.responses).toHaveProperty("403");
    expect(adminInvitationDetailPath?.patch?.responses).toHaveProperty("404");
    expect(adminInvitationDetailPath?.patch?.responses).toHaveProperty("409");
    expect(adminInvitationPublicUrlPath?.get).toBeDefined();
    expect(adminInvitationPublicUrlPath?.get?.responses).toHaveProperty("200");
    expect(adminInvitationPublicUrlPath?.post).toBeUndefined();
    expect(adminInvitationArchivePath?.post).toBeDefined();
    expect(adminInvitationArchivePath?.post?.responses).toHaveProperty("200");
    expect(adminInvitationArchivePath?.post?.responses).toHaveProperty("400");
    expect(adminInvitationArchivePath?.post?.responses).toHaveProperty("401");
    expect(adminInvitationArchivePath?.post?.responses).toHaveProperty("403");
    expect(adminInvitationArchivePath?.post?.responses).toHaveProperty("404");
    expect(adminInvitationArchivePath?.post?.responses).toHaveProperty("409");
    expect(adminInvitationRegenerateTokenPath?.post).toBeDefined();
    expect(adminInvitationRegenerateTokenPath?.post?.requestBody).toBeDefined();
    expect(adminInvitationRegenerateTokenPath?.post?.responses).toHaveProperty(
      "200",
    );
    expect(adminInvitationRegenerateTokenPath?.post?.responses).toHaveProperty(
      "400",
    );
    expect(adminInvitationRegenerateTokenPath?.post?.responses).toHaveProperty(
      "401",
    );
    expect(adminInvitationRegenerateTokenPath?.post?.responses).toHaveProperty(
      "403",
    );
    expect(adminInvitationRegenerateTokenPath?.post?.responses).toHaveProperty(
      "404",
    );
    expect(adminInvitationRegenerateTokenPath?.post?.responses).toHaveProperty(
      "409",
    );
    expect(document.paths["/api/admin/auth/bootstrap"]).toBeUndefined();
    expect(
      document.paths["/api/admin/invitations/{invitationId}/invitees"],
    ).toBeUndefined();
    expect(
      document.paths["/api/admin/invitations/{invitationId}/events"],
    ).toBeUndefined();
    expect(document.paths["/api/admin/rsvps"]).toBeUndefined();
    expect(document.paths["/api/admin/messages"]).toBeUndefined();
    expect(document.paths["/api/admin/events/{eventId}"]).toBeUndefined();
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
    expect(schemas).toHaveProperty("AdminLoginRequestDto");
    expect(schemas).toHaveProperty("AdminAuthResponseDto");
    expect(schemas).toHaveProperty("AdminDashboardResponseDto");
    expect(schemas).toHaveProperty("AdminEventsResponseDto");
    expect(schemas).toHaveProperty("AdminInvitationListResponseDto");
    expect(schemas).toHaveProperty("AdminInvitationDetailResponseDto");
    expect(schemas).toHaveProperty("AdminInvitationPublicUrlResponseDto");
    expect(schemas).toHaveProperty("CreateAdminInvitationRequestDto");
    expect(schemas).toHaveProperty("CreateAdminInvitationResponseDto");
    expect(schemas).toHaveProperty("UpdateAdminInvitationRequestDto");
    expect(schemas).toHaveProperty("ArchiveAdminInvitationResponseDto");
    expect(schemas).toHaveProperty("RegenerateInvitationTokenRequestDto");
    expect(schemas).toHaveProperty("ApiErrorEnvelopeDto");
    const adminSchemas = Object.fromEntries(
      Object.entries(schemas).filter(([name]) => name.startsWith("Admin")),
    );
    expect(JSON.stringify(schemas)).not.toContain("publicTokenHash");
    expect(JSON.stringify(schemas)).not.toContain("tokenHash");
    expect(JSON.stringify(adminSchemas)).not.toContain("qrPayload");
    expect(JSON.stringify(adminSchemas)).not.toContain("passwordHash");
    expect(JSON.stringify(adminSchemas)).not.toContain("sessionTokenHash");
    expect(JSON.stringify(adminSchemas)).not.toContain("csrfTokenHash");

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
    expect(schemas.AdminLoginRequestDto).toMatchObject({
      properties: {
        email: expect.objectContaining({
          maxLength: 254,
          type: "string",
        }),
        password: expect.objectContaining({
          maxLength: 128,
          minLength: 15,
          type: "string",
        }),
      },
      required: ["email", "password"],
    });
    expect(schemas.AdminAuthResponseDto).toMatchObject({
      properties: {
        csrfToken: expect.objectContaining({ type: "string" }),
        session: expect.objectContaining({
          $ref: "#/components/schemas/AdminAuthSessionDto",
        }),
        user: expect.objectContaining({
          $ref: "#/components/schemas/AdminAuthUserDto",
        }),
      },
      required: ["user", "session", "csrfToken"],
    });
    expect(JSON.stringify(schemas.AdminAuthResponseDto)).not.toContain(
      "passwordHash",
    );
    expect(JSON.stringify(schemas.AdminAuthResponseDto)).not.toContain(
      "sessionToken",
    );
    expect(JSON.stringify(schemas.AdminAuthResponseDto)).not.toContain(
      "sessionTokenHash",
    );
    expect(JSON.stringify(schemas.AdminAuthResponseDto)).not.toContain(
      "csrfTokenHash",
    );
    expect(schemas.AdminInvitationListItemDto).toMatchObject({
      properties: expect.objectContaining({
        displayName: expect.objectContaining({ type: "string" }),
        rsvpStatus: expect.objectContaining({
          enum: ["PENDING", "ACCEPTED", "DECLINED"],
        }),
      }),
    });
    expect(JSON.stringify(schemas.AdminInvitationListItemDto)).not.toContain(
      "notes",
    );
    expect(JSON.stringify(schemas.AdminInvitationListItemDto)).not.toContain(
      "publicTokenVersion",
    );
    expect(schemas.AdminInvitationDetailDto).toMatchObject({
      properties: expect.objectContaining({
        notes: expect.objectContaining({ nullable: true }),
        publicTokenVersion: expect.objectContaining({ type: "number" }),
      }),
    });
    expect(schemas).toHaveProperty("AdminInvitationRsvpSummaryDto");
    expect(schemas).not.toHaveProperty("AdminRsvpDetailDto");
    const adminInvitationRsvpSummarySchema = schemas.AdminInvitationRsvpSummaryDto as
      | {
          properties: Record<string, unknown>;
          required: string[];
        }
      | undefined;

    expect(adminInvitationRsvpSummarySchema).toBeDefined();
    expect(schemas.AdminInvitationDetailDto).toMatchObject({
      properties: expect.objectContaining({
        rsvp: expect.objectContaining({
          allOf: [
            {
              $ref: "#/components/schemas/AdminInvitationRsvpSummaryDto",
            },
          ],
          nullable: true,
        }),
      }),
    });
    expect(Object.keys(adminInvitationRsvpSummarySchema!.properties).sort()).toEqual([
      "lastUpdatedAt",
      "status",
      "submittedAt",
      "version",
    ]);
    expect(adminInvitationRsvpSummarySchema!.required.sort()).toEqual([
      "lastUpdatedAt",
      "status",
      "submittedAt",
      "version",
    ]);
    for (const field of [
      "attendeeQuantityTotal",
      "attendees",
      "eventSelections",
      "dietaryNotes",
      "guestNote",
      "adminOverrideReason",
      "submittedByAdminUserId",
      "adminUser",
    ]) {
      expect(adminInvitationRsvpSummarySchema!.properties).not.toHaveProperty(
        field,
      );
    }
    expect(schemas.AdminInvitationPublicUrlResponseDto).toMatchObject({
      properties: {
        publicTokenVersion: expect.objectContaining({ type: "number" }),
        publicUrl: expect.objectContaining({ type: "string" }),
      },
      required: ["publicUrl", "publicTokenVersion"],
    });
    expect(schemas.CreateAdminInvitationRequestDto).toMatchObject({
      properties: expect.objectContaining({
        eventIds: expect.objectContaining({ type: "array" }),
        invitees: expect.objectContaining({ type: "array" }),
      }),
      required: [
        "displayName",
        "greetingName",
        "allowPlusOne",
        "maxAdditionalChildren",
        "rsvpDeadlineAt",
        "notes",
        "eventIds",
        "invitees",
      ],
    });
    expect(schemas.UpdateAdminInvitationRequestDto).toMatchObject({
      properties: expect.objectContaining({
        expectedUpdatedAt: expect.objectContaining({
          format: "date-time",
          type: "string",
        }),
      }),
      required: ["expectedUpdatedAt"],
    });
    expect(schemas.RegenerateInvitationTokenRequestDto).toMatchObject({
      properties: {
        expectedTokenVersion: expect.objectContaining({
          minimum: 1,
          type: "number",
        }),
      },
      required: ["expectedTokenVersion"],
    });
    expect(JSON.stringify(schemas.ArchiveAdminInvitationResponseDto)).not.toContain(
      "reason",
    );
  });
});
