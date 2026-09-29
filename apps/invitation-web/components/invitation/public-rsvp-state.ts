import type {
  PublicInvitationResponse,
  PublicRsvpReadResponse,
  SubmitPublicRsvpRequest,
} from "../../../../packages/api-client/src/index";

export type RsvpInvitation = Pick<
  PublicInvitationResponse["invitation"],
  "invitees" | "rules"
> & {
  events: Pick<
    PublicInvitationResponse["invitation"]["events"][number],
    "id" | "name"
  >[];
};

export type RsvpDraft = {
  status: SubmitPublicRsvpRequest["status"] | "";
  namedInviteeIds: string[];
  plusOne: boolean;
  additionalChildren: number;
  eventSelections: SubmitPublicRsvpRequest["eventSelections"];
  dietaryNotes: string;
};

export function createRsvpDraft(
  invitation: RsvpInvitation,
  rsvp: PublicRsvpReadResponse["rsvp"],
): RsvpDraft {
  const accepted = rsvp?.status === "ACCEPTED" ? rsvp : null;
  return {
    status:
      rsvp?.status === "ACCEPTED" || rsvp?.status === "DECLINED"
        ? rsvp.status
        : "",
    namedInviteeIds: invitation.invitees
      .filter((invitee) =>
        accepted?.attendees.some(
          (attendee) =>
            attendee.type === "NAMED_INVITEE" &&
            attendee.inviteeId === invitee.id,
        ),
      )
      .map((invitee) => invitee.id),
    plusOne:
      invitation.rules.allowPlusOne &&
      Boolean(
        accepted?.attendees.some((attendee) => attendee.type === "PLUS_ONE"),
      ),
    additionalChildren: Math.min(
      invitation.rules.maxAdditionalChildren,
      accepted?.attendees.reduce(
        (total, attendee) =>
          total +
          (attendee.type === "ADDITIONAL_CHILD" ? attendee.quantity : 0),
        0,
      ) ?? 0,
    ),
    eventSelections: invitation.events.map((event) => {
      const selection = accepted?.eventSelections.find(
        (item) => item.eventId === event.id,
      );
      return {
        eventId: event.id,
        attending: selection?.attending ?? false,
        expectedAttendeeCount: selection?.attending
          ? selection.expectedAttendeeCount
          : 0,
      };
    }),
    dietaryNotes: accepted?.dietaryNotes ?? "",
  };
}

export function attendeeTotal(draft: RsvpDraft): number {
  return (
    draft.namedInviteeIds.length +
    Number(draft.plusOne) +
    draft.additionalChildren
  );
}

// Keep selected events, lower excessive counts, and restore the minimum when
// people are added again. No person-to-event assignment is implied.
export function normalizeEventCounts(draft: RsvpDraft): RsvpDraft {
  const total = attendeeTotal(draft);
  return {
    ...draft,
    eventSelections: draft.eventSelections.map((event) => ({
      ...event,
      expectedAttendeeCount: event.attending
        ? Math.min(total, Math.max(1, event.expectedAttendeeCount))
        : 0,
    })),
  };
}

export function validateRsvpDraft(
  draft: RsvpDraft,
  invitation: RsvpInvitation,
): string | null {
  if (!draft.status) return "Please choose whether you can join us.";
  if (draft.status === "DECLINED") return null;
  const total = attendeeTotal(draft);
  if (
    !Number.isInteger(draft.additionalChildren) ||
    draft.additionalChildren < 0 ||
    draft.additionalChildren > invitation.rules.maxAdditionalChildren
  )
    return "Please check the number of additional children.";
  if (total < 1) return "Please select at least one person attending.";
  if (!draft.eventSelections.some((event) => event.attending))
    return "Please select at least one event to attend.";
  if (
    draft.eventSelections.some(
      (event) =>
        !Number.isInteger(event.expectedAttendeeCount) ||
        (event.attending
          ? event.expectedAttendeeCount < 1 ||
            event.expectedAttendeeCount > total
          : event.expectedAttendeeCount !== 0),
    )
  )
    return "Please keep each event count between 1 and your total number of attendees.";
  if (draft.dietaryNotes.trim().length > 500)
    return "Please limit dietary notes to 500 characters.";
  return null;
}

export function toRsvpRequest(
  draft: RsvpDraft,
  expectedVersion: number | null,
): SubmitPublicRsvpRequest {
  if (!draft.status) throw new Error("An attendance choice is required.");
  if (draft.status === "DECLINED")
    return {
      expectedVersion,
      status: "DECLINED",
      eventSelections: [],
      attendees: [],
      dietaryNotes: null,
    };
  const attendees: SubmitPublicRsvpRequest["attendees"] =
    draft.namedInviteeIds.map((inviteeId) => ({
      type: "NAMED_INVITEE",
      inviteeId,
      quantity: 1,
    }));
  if (draft.plusOne)
    attendees.push({ type: "PLUS_ONE", inviteeId: null, quantity: 1 });
  if (draft.additionalChildren > 0)
    attendees.push({
      type: "ADDITIONAL_CHILD",
      inviteeId: null,
      quantity: draft.additionalChildren,
    });
  return {
    expectedVersion,
    status: "ACCEPTED",
    attendees,
    eventSelections: draft.eventSelections.map((event) => ({
      ...event,
      expectedAttendeeCount: event.attending ? event.expectedAttendeeCount : 0,
    })),
    dietaryNotes: draft.dietaryNotes.trim() || null,
  };
}
