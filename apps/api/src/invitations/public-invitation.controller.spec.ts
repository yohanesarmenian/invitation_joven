import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiExceptionFilter } from "../common/api-exception.filter.js";
import { PublicInvitationController } from "./public-invitation.controller.js";
import { InvitationNotAvailableError } from "./invitation-not-available.error.js";
import { PublicInvitationService } from "./public-invitation.service.js";

const credential = "A".repeat(43);

const responseBody = {
  invitation: {
    displayName: "Controller Household",
    events: [],
    greetingName: null,
    invitees: [],
    rsvp: null,
    rsvpDeadlineAt: null,
    rules: {
      allowPlusOne: false,
      maxAdditionalChildren: 0,
    },
  },
};

@Controller("test")
class UnexpectedController {
  @Get("boom")
  boom() {
    throw new Error("unexpected controller failure");
  }
}

function createServiceMock() {
  return {
    retrievePublicInvitation: vi.fn(),
  };
}

describe("PublicInvitationController", () => {
  let app: NestFastifyApplication;
  let service: ReturnType<typeof createServiceMock>;

  beforeEach(async () => {
    service = createServiceMock();

    @Module({
      controllers: [PublicInvitationController, UnexpectedController],
      providers: [
        {
          provide: PublicInvitationService,
          useValue: service,
        },
      ],
    })
    class TestModule {}

    app = await NestFactory.create<NestFastifyApplication>(
      TestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("passes the raw route parameter to the public invitation service", async () => {
    service.retrievePublicInvitation.mockResolvedValueOnce(responseBody);

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${credential}`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(responseBody);
    expect(service.retrievePublicInvitation).toHaveBeenCalledExactlyOnceWith(
      credential,
    );
  });

  it("maps unavailable invitations to the common 404 envelope", async () => {
    service.retrievePublicInvitation.mockRejectedValueOnce(
      new InvitationNotAvailableError(),
    );

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: "/api/public/invitations/bad",
        headers: {
          "x-request-id": "req-controller404",
        },
      });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "INVITATION_NOT_AVAILABLE",
        details: null,
        message: "Resource not found",
      },
      requestId: "req-controller404",
      timestamp: expect.any(String),
    });
    expect(service.retrievePublicInvitation).toHaveBeenCalledExactlyOnceWith(
      "bad",
    );
  });

  it("does not collapse unexpected failures into invitation-unavailable responses", async () => {
    service.retrievePublicInvitation.mockRejectedValueOnce(
      new Error("controlled failure"),
    );

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${credential}`,
      });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        details: null,
        message: "Internal server error",
      },
    });
  });
});
