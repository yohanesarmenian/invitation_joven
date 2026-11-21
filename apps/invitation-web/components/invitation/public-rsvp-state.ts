import type {
  PublicInvitationResponse,
  PublicRsvpReadResponse,
  SubmitPublicRsvpRequest,
} from "../../../../packages/api-client/src/index";

export type RsvpInvitation = Pick<
  PublicInvitationResponse["invitation"],
  "invitees" | "rules"
> & {
  events: Array<{ id: string; name: string; slug?: string }>;
};
export type PartyMode = NonNullable<SubmitPublicRsvpRequest["partyMode"]>;
type SavedRsvp = NonNullable<PublicRsvpReadResponse["rsvp"]>;

export type RsvpDraft = {
  status: SubmitPublicRsvpRequest["status"] | "";
  sessionIds: string[];
  partyMode: PartyMode | "";
  namedInviteeIds: string[];
  plusOne: boolean;
  includeChildren: boolean;
  additionalChildren: number;
  dietaryNotes: string;
};

export function sessionOptions(events: RsvpInvitation["events"]) {
  if (
    events.length < 1 ||
    events.length > 2 ||
    new Set(events.map(({ id }) => id)).size !== events.length
  )
    return [];
  const choices = events.map(({ id, name, slug }) => ({
    label:
      slug && events.filter((event) => event.name === name).length > 1
        ? `${name} (${slug})`
        : name,
    ids: [id],
  }));
  if (events.length === 2)
    choices.push({
      label: choices.map(({ label }) => label).join(" & "),
      ids: events.map(({ id }) => id),
    });
  return choices;
}

function sameIds(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((id) => right.includes(id))
  );
}

export function createRsvpDraft(
  rsvp: PublicRsvpReadResponse["rsvp"],
): RsvpDraft {
  return {
    status: rsvp?.status === "DECLINED" ? "DECLINED" : "",
    sessionIds: [],
    partyMode: "",
    namedInviteeIds: [],
    plusOne: false,
    includeChildren: false,
    additionalChildren: 0,
    dietaryNotes: rsvp?.dietaryNotes ?? "",
  };
}

export function attendeeOptions(
  invitation: RsvpInvitation,
  mode: RsvpDraft["partyMode"],
) {
  return invitation.invitees.filter(
    ({ category }) => mode === "ALONE" || category === "ADULT",
  );
}

export function changePartyMode(
  draft: RsvpDraft,
  invitation: RsvpInvitation,
  partyMode: PartyMode,
): RsvpDraft {
  const options = attendeeOptions(invitation, partyMode);
  const previous = options.filter(({ id }) =>
    draft.namedInviteeIds.includes(id),
  );
  const selected =
    options.length === 1 ? options : previous.length === 1 ? previous : [];
  return {
    ...draft,
    partyMode,
    namedInviteeIds: selected.map(({ id }) => id),
    plusOne: partyMode === "PLUS_ONE",
    includeChildren: false,
    additionalChildren: 0,
  };
}

export function attendeeTotal(draft: RsvpDraft): number {
  return (
    draft.namedInviteeIds.length +
    Number(draft.plusOne) +
    draft.additionalChildren
  );
}

export function selectedSession(draft: RsvpDraft, invitation: RsvpInvitation) {
  return sessionOptions(invitation.events).find(({ ids }) =>
    sameIds(draft.sessionIds, ids),
  );
}

export function partyIssue(
  draft: RsvpDraft,
  invitation: RsvpInvitation,
): string | null {
  if (!draft.partyMode) return "Please choose who will attend.";
  const named = invitation.invitees.filter(({ id }) =>
    draft.namedInviteeIds.includes(id),
  );
  if (named.length !== draft.namedInviteeIds.length)
    return "Please select names from this invitation.";
  const adults = named.filter(({ category }) => category === "ADULT").length;
  const children = named.length - adults;
  if (
    !Number.isSafeInteger(draft.additionalChildren) ||
    draft.additionalChildren < 0 ||
    draft.additionalChildren > invitation.rules.maxAdditionalChildren
  )
    return "Please check the number of additional children.";
  if (draft.plusOne && !invitation.rules.allowPlusOne)
    return "This invitation does not include an additional companion.";
  if (draft.partyMode === "ALONE")
    return named.length === 1 &&
      !draft.plusOne &&
      !draft.includeChildren &&
      draft.additionalChildren === 0
      ? null
      : "Please select one invited attendee.";
  if (draft.partyMode === "PLUS_ONE")
    return adults === 1 &&
      named.length === 1 &&
      draft.plusOne &&
      !draft.includeChildren &&
      draft.additionalChildren === 0
      ? null
      : "Please select one invited adult for this plus-one response.";
  if (!adults || adults + Number(draft.plusOne) > 2)
    return "Please select one or two adults, including any additional partner.";
  return draft.includeChildren === children + draft.additionalChildren > 0
    ? null
    : "Please select the invited children or enter the number of additional children.";
}

export function restoreSavedDraft(
  invitation: RsvpInvitation,
  rsvp: SavedRsvp,
): RsvpDraft | null {
  if (rsvp.status !== "ACCEPTED") return createRsvpDraft(rsvp);
  if (
    !rsvp.partyMode ||
    rsvp.attendees.some(({ type }) => type === "UNNAMED_COMPANION") ||
    rsvp.attendees.some(
      ({ type, quantity }) => type !== "ADDITIONAL_CHILD" && quantity !== 1,
    ) ||
    rsvp.attendees.filter(({ type }) => type === "PLUS_ONE").length > 1 ||
    rsvp.attendees.filter(({ type }) => type === "ADDITIONAL_CHILD").length > 1
  )
    return null;
  const namedInviteeIds = rsvp.attendees
    .filter(({ type }) => type === "NAMED_INVITEE")
    .map(({ inviteeId }) => inviteeId ?? "");
  const plusOne = rsvp.attendees.some(({ type }) => type === "PLUS_ONE");
  const additionalChildren =
    rsvp.attendees.find(({ type }) => type === "ADDITIONAL_CHILD")?.quantity ??
    0;
  const attending = rsvp.eventSelections.filter((item) => item.attending);
  const sessionIds = attending.map(({ eventId }) => eventId);
  const namedChildren = invitation.invitees.filter(
    ({ id, category }) => category === "CHILD" && namedInviteeIds.includes(id),
  ).length;
  const includeChildren = Boolean(namedChildren || additionalChildren);
  const partyMode = rsvp.partyMode;
  const draft: RsvpDraft = {
    status: "ACCEPTED",
    partyMode,
    sessionIds,
    namedInviteeIds,
    plusOne,
    additionalChildren,
    includeChildren: partyMode === "FAMILY" && includeChildren,
    dietaryNotes: rsvp.dietaryNotes ?? "",
  };
  const total = attendeeTotal(draft);
  return selectedSession(draft, invitation) &&
    !partyIssue(draft, invitation) &&
    total === rsvp.attendeeQuantityTotal &&
    attending.every(
      ({ expectedAttendeeCount }) => expectedAttendeeCount === total,
    )
    ? draft
    : null;
}

export function sameAttendance(
  draft: RsvpDraft,
  saved: RsvpDraft | null,
): boolean {
  return Boolean(
    saved &&
    draft.status === saved.status &&
    draft.partyMode === saved.partyMode &&
    draft.plusOne === saved.plusOne &&
    draft.additionalChildren === saved.additionalChildren &&
    sameIds(draft.sessionIds, saved.sessionIds) &&
    sameIds(draft.namedInviteeIds, saved.namedInviteeIds),
  );
}

export function validateRsvpDraft(
  draft: RsvpDraft,
  invitation: RsvpInvitation,
): string | null {
  if (!draft.status) return "Please choose whether you can join us.";
  if (draft.status === "DECLINED") return null;
  if (!selectedSession(draft, invitation))
    return "Please choose the wedding sessions you’ll attend.";
  return (
    partyIssue(draft, invitation) ??
    (draft.dietaryNotes.trim().length > 500
      ? "Please limit dietary notes to 500 characters."
      : null)
  );
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
  if (!draft.partyMode) throw new Error("A party choice is required.");
  const attendees: SubmitPublicRsvpRequest["attendees"] =
    draft.namedInviteeIds.map((inviteeId) => ({
      type: "NAMED_INVITEE",
      inviteeId,
      quantity: 1,
    }));
  if (draft.plusOne)
    attendees.push({ type: "PLUS_ONE", inviteeId: null, quantity: 1 });
  if (draft.additionalChildren)
    attendees.push({
      type: "ADDITIONAL_CHILD",
      inviteeId: null,
      quantity: draft.additionalChildren,
    });
  const expectedAttendeeCount = attendeeTotal(draft);
  return {
    expectedVersion,
    status: "ACCEPTED",
    partyMode: draft.partyMode,
    attendees,
    eventSelections: draft.sessionIds.map((eventId) => ({
      eventId,
      attending: true,
      expectedAttendeeCount,
    })),
    dietaryNotes: draft.dietaryNotes.trim() || null,
  };
}
