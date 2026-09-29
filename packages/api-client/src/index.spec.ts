import { describe, expect, it } from "vitest";
import type { components, paths } from "./generated/schema.js";
import {
  createInvitationApiClient,
  type PublicRsvpReadResponse,
  type SubmitPublicRsvpRequest,
} from "./index.js";

function assertApiPath(path: keyof paths): keyof paths {
  return path;
}

describe("generated API client", () => {
  it("exposes the public invitation retrieval operation and response schema", () => {
    expect(assertApiPath("/api/public/invitations/{publicCredential}")).toBe(
      "/api/public/invitations/{publicCredential}",
    );

    const response: components["schemas"]["PublicInvitationResponseDto"] = {
      invitation: {
        displayName: "Example Household",
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
    const client = createInvitationApiClient({
      baseUrl: "https://example.test",
    });

    expect(response.invitation.rsvp).toBeNull();
    expect(typeof client.GET).toBe("function");
  });

  it("exposes the public RSVP operations and schemas", () => {
    expect(
      assertApiPath("/api/public/invitations/{publicCredential}/rsvp"),
    ).toBe("/api/public/invitations/{publicCredential}/rsvp");

    const request: SubmitPublicRsvpRequest = {
      attendees: [
        {
          inviteeId: "22222222-2222-4222-8222-222222222222",
          quantity: 1,
          type: "NAMED_INVITEE",
        },
      ],
      eventSelections: [
        {
          attending: true,
          eventId: "11111111-1111-4111-8111-111111111111",
          expectedAttendeeCount: 1,
        },
      ],
      expectedVersion: null,
      status: "ACCEPTED",
    };
    const response: PublicRsvpReadResponse = {
      checkinPass: null,
      rsvp: {
        attendeeQuantityTotal: 1,
        attendees: request.attendees.map((attendee) => ({
          inviteeId: attendee.inviteeId ?? null,
          quantity: attendee.quantity,
          type: attendee.type,
        })),
        dietaryNotes: null,
        eventSelections: request.eventSelections,
        status: "ACCEPTED",
        version: 1,
      },
    };

    expect(response.rsvp?.eventSelections[0]?.eventId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });
});
