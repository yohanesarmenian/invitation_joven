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
import { PublicRsvpDomainError } from "./public-rsvp.errors.js";
import { PublicRsvpService } from "./public-rsvp.service.js";

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

function createRsvpServiceMock() {
  return {
    retrievePublicRsvp: vi.fn(),
    submitPublicRsvp: vi.fn(),
  };
}

describe("PublicInvitationController", () => {
  let app: NestFastifyApplication;
  let service: ReturnType<typeof createServiceMock>;
  let rsvpService: ReturnType<typeof createRsvpServiceMock>;

  beforeEach(async () => {
    service = createServiceMock();
    rsvpService = createRsvpServiceMock();

    @Module({
      controllers: [PublicInvitationController, UnexpectedController],
      providers: [
        {
          provide: PublicInvitationService,
          useValue: service,
        },
        {
          provide: PublicRsvpService,
          useValue: rsvpService,
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

  it("passes validated RSVP submissions to the public RSVP service", async () => {
    rsvpService.submitPublicRsvp.mockResolvedValueOnce({
      checkinPass: {
        issuedAt: "2026-09-17T00:00:00.000Z",
        status: "ACTIVE",
      },
      rsvp: {
        attendeeQuantityTotal: 1,
        attendees: [
          {
            inviteeId: "22222222-2222-4222-8222-222222222222",
            quantity: 1,
            type: "NAMED_INVITEE",
          },
        ],
        dietaryNotes: "No seafood",
        eventSelections: [
          {
            attending: true,
            eventId: "11111111-1111-4111-8111-111111111111",
            expectedAttendeeCount: 1,
          },
        ],
        status: "ACCEPTED",
        version: 1,
      },
    });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [
            {
              inviteeId: "22222222-2222-4222-8222-222222222222",
              quantity: 1,
              type: "NAMED_INVITEE",
            },
          ],
          dietaryNotes: "No seafood",
          eventSelections: [
            {
              attending: true,
              eventId: "11111111-1111-4111-8111-111111111111",
              expectedAttendeeCount: 1,
            },
          ],
          expectedVersion: null,
          status: "ACCEPTED",
        },
        url: `/api/public/invitations/${credential}/rsvp`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      checkinPass: {
        status: "ACTIVE",
      },
      rsvp: {
        status: "ACCEPTED",
        version: 1,
      },
    });
    expect(rsvpService.submitPublicRsvp).toHaveBeenCalledExactlyOnceWith({
      attendees: [
        {
          inviteeId: "22222222-2222-4222-8222-222222222222",
          quantity: 1,
          type: "NAMED_INVITEE",
        },
      ],
      dietaryNotes: "No seafood",
      eventSelections: [
        {
          attending: true,
          eventId: "11111111-1111-4111-8111-111111111111",
          expectedAttendeeCount: 1,
        },
      ],
      expectedVersion: null,
      publicCredential: credential,
      status: "ACCEPTED",
    });
  });

  it("passes declined RSVP submissions to the public RSVP service", async () => {
    rsvpService.submitPublicRsvp.mockResolvedValueOnce({
      checkinPass: null,
      rsvp: {
        attendeeQuantityTotal: 0,
        attendees: [],
        dietaryNotes: null,
        eventSelections: [],
        status: "DECLINED",
        version: 1,
      },
    });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: "DECLINED",
        },
        url: `/api/public/invitations/${credential}/rsvp`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      checkinPass: null,
      rsvp: {
        attendeeQuantityTotal: 0,
        attendees: [],
        dietaryNotes: null,
        eventSelections: [],
        status: "DECLINED",
        version: 1,
      },
    });
    expect(rsvpService.submitPublicRsvp).toHaveBeenCalledExactlyOnceWith({
      attendees: [],
      eventSelections: [],
      expectedVersion: null,
      publicCredential: credential,
      status: "DECLINED",
    });
  });

  it("maps malformed RSVP payloads to the common 400 envelope", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [
            {
              attending: true,
              eventId: "not-a-uuid",
              expectedAttendeeCount: 1,
            },
          ],
          expectedVersion: null,
          status: "ACCEPTED",
        },
        url: `/api/public/invitations/${credential}/rsvp`,
      });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "BAD_REQUEST",
        details: null,
        message: "Bad request",
      },
    });
    expect(rsvpService.submitPublicRsvp).not.toHaveBeenCalled();
  });

  it("maps public RSVP version conflicts to the common 409 envelope", async () => {
    rsvpService.submitPublicRsvp.mockRejectedValueOnce(
      new PublicRsvpDomainError("RSVP_VERSION_CONFLICT"),
    );

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: "DECLINED",
        },
        url: `/api/public/invitations/${credential}/rsvp`,
      });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "RSVP_VERSION_CONFLICT",
        details: null,
        message: "RSVP version conflict",
      },
    });
  });

  it("maps public RSVP domain validation errors to the common 422 envelope", async () => {
    rsvpService.submitPublicRsvp.mockRejectedValueOnce(
      new PublicRsvpDomainError("EVENT_NOT_SELECTED"),
    );

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "PUT",
        payload: {
          attendees: [],
          eventSelections: [],
          expectedVersion: null,
          status: "ACCEPTED",
        },
        url: `/api/public/invitations/${credential}/rsvp`,
      });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: "EVENT_NOT_SELECTED",
        details: null,
        message: "Event is not selected",
      },
    });
  });

  it("retrieves current public RSVP state", async () => {
    rsvpService.retrievePublicRsvp.mockResolvedValueOnce({
      checkinPass: null,
      rsvp: null,
    });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "GET",
        url: `/api/public/invitations/${credential}/rsvp`,
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      checkinPass: null,
      rsvp: null,
    });
    expect(rsvpService.retrievePublicRsvp).toHaveBeenCalledExactlyOnceWith(
      credential,
    );
  });
});
