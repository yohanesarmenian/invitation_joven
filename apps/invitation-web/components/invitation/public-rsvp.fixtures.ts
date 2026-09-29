import type { PublicRsvpReadResponse } from "../../../../packages/api-client/src/index";
import type { RsvpInvitation } from "./public-rsvp-state";

export const rsvpInvitation: RsvpInvitation = {
  events: [
    { id: "event-1", name: "Holy Matrimony" },
    { id: "event-2", name: "Reception" },
  ],
  invitees: [
    { id: "invitee-1", fullName: "Alex Guest", category: "ADULT" },
    { id: "invitee-2", fullName: "Robin Guest", category: "CHILD" },
  ],
  rules: { allowPlusOne: true, maxAdditionalChildren: 2 },
};

export const acceptedRsvp: NonNullable<PublicRsvpReadResponse["rsvp"]> = {
  status: "ACCEPTED",
  version: 7,
  dietaryNotes: "No seafood",
  attendeeQuantityTotal: 4,
  attendees: [
    { type: "NAMED_INVITEE", inviteeId: "invitee-1", quantity: 1 },
    { type: "PLUS_ONE", inviteeId: null, quantity: 1 },
    { type: "ADDITIONAL_CHILD", inviteeId: null, quantity: 2 },
  ],
  eventSelections: [
    { eventId: "event-1", attending: true, expectedAttendeeCount: 4 },
    { eventId: "event-2", attending: true, expectedAttendeeCount: 2 },
  ],
};
