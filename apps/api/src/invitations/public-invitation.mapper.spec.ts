import { describe, expect, it } from "vitest";
import { mapPublicInvitationResponse } from "./public-invitation.mapper.js";

const richProjection = {
  id: "invitation-private-id",
  displayName: "The Santoso Family",
  greetingName: "Joven and Family",
  rsvpDeadlineAt: new Date("2026-11-01T12:00:00.000Z"),
  publicTokenHash: "private-lookup-hash",
  publicTokenVersion: 7,
  status: "ACTIVE",
  openCount: 12,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  events: [
    {
      id: "event-reception",
      slug: "reception",
      name: "Reception",
      startsAt: new Date("2026-12-12T12:00:00.000Z"),
      venueName: "Grand Ballroom",
      address: "123 Celebration Avenue",
      googleMapsUrl: "https://maps.example/reception",
      description: "private editorial copy",
      endsAt: new Date("2026-12-12T15:00:00.000Z"),
      displayOrder: 20,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "event-ceremony",
      slug: "ceremony",
      name: "Ceremony",
      startsAt: null,
      venueName: null,
      address: null,
      googleMapsUrl: null,
      description: "another private description",
      endsAt: null,
      displayOrder: 10,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ],
  invitees: [
    {
      id: "invitee-child",
      fullName: "Ari Santoso",
      category: "CHILD",
      invitationId: "invitation-private-id",
      displayOrder: 20,
      label: "Youngest",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "invitee-adult",
      fullName: "Bima Santoso",
      category: "ADULT",
      invitationId: "invitation-private-id",
      displayOrder: 10,
      label: "Primary contact",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ],
  allowPlusOne: true,
  maxAdditionalChildren: 2,
  rsvp: {
    id: "rsvp-private-id",
    invitationId: "invitation-private-id",
    status: "ACCEPTED",
    version: 3,
    notes: "private response notes",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
} as const;

describe("mapPublicInvitationResponse", () => {
  it("maps the exact public response and serializes dates as ISO strings", () => {
    const response = mapPublicInvitationResponse(richProjection);

    expect(response).toEqual({
      invitation: {
        displayName: "The Santoso Family",
        greetingName: "Joven and Family",
        rsvpDeadlineAt: "2026-11-01T12:00:00.000Z",
        events: [
          {
            id: "event-reception",
            slug: "reception",
            name: "Reception",
            startsAt: "2026-12-12T12:00:00.000Z",
            venueName: "Grand Ballroom",
            address: "123 Celebration Avenue",
            googleMapsUrl: "https://maps.example/reception",
          },
          {
            id: "event-ceremony",
            slug: "ceremony",
            name: "Ceremony",
            startsAt: null,
            venueName: null,
            address: null,
            googleMapsUrl: null,
          },
        ],
        invitees: [
          {
            id: "invitee-child",
            fullName: "Ari Santoso",
            category: "CHILD",
          },
          {
            id: "invitee-adult",
            fullName: "Bima Santoso",
            category: "ADULT",
          },
        ],
        rules: {
          allowPlusOne: true,
          maxAdditionalChildren: 2,
        },
        rsvp: {
          status: "ACCEPTED",
          version: 3,
        },
      },
    });
    expect(response.invitation.rsvp).not.toHaveProperty("deadlineAt");
  });

  it("emits null for an absent persisted RSVP and retains every nullable key", () => {
    const response = mapPublicInvitationResponse({
      displayName: "Guest",
      greetingName: null,
      rsvpDeadlineAt: null,
      events: [
        {
          id: "event",
          slug: "event",
          name: "Event",
          startsAt: null,
          venueName: null,
          address: null,
          googleMapsUrl: null,
        },
      ],
      invitees: [],
      allowPlusOne: false,
      maxAdditionalChildren: 0,
      rsvp: null,
    });

    expect(response.invitation).toMatchObject({
      greetingName: null,
      rsvpDeadlineAt: null,
      rsvp: null,
    });
    expect(response.invitation.events[0]).toEqual({
      id: "event",
      slug: "event",
      name: "Event",
      startsAt: null,
      venueName: null,
      address: null,
      googleMapsUrl: null,
    });
  });

  it("preserves retrieval order for events and invitees", () => {
    const response = mapPublicInvitationResponse(richProjection);

    expect(response.invitation.events.map(({ id }) => id)).toEqual([
      "event-reception",
      "event-ceremony",
    ]);
    expect(response.invitation.invitees.map(({ id }) => id)).toEqual([
      "invitee-child",
      "invitee-adult",
    ]);
  });

  it("excludes private invitation, event, invitee, and RSVP metadata", () => {
    const response = mapPublicInvitationResponse(richProjection);

    expect(Object.keys(response.invitation)).toEqual([
      "displayName",
      "greetingName",
      "rsvpDeadlineAt",
      "events",
      "invitees",
      "rules",
      "rsvp",
    ]);
    expect(Object.keys(response.invitation.events[0] ?? {})).toEqual([
      "id",
      "slug",
      "name",
      "startsAt",
      "venueName",
      "address",
      "googleMapsUrl",
    ]);
    expect(Object.keys(response.invitation.invitees[0] ?? {})).toEqual([
      "id",
      "fullName",
      "category",
    ]);
    expect(Object.keys(response.invitation.rsvp ?? {})).toEqual([
      "status",
      "version",
    ]);

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("invitation-private-id");
    expect(serialized).not.toContain("private-lookup-hash");
    expect(serialized).not.toContain("private editorial copy");
    expect(serialized).not.toContain("Primary contact");
    expect(serialized).not.toContain("private response notes");
  });
});
