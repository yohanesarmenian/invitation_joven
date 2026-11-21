import { describe, expect, it } from "vitest";
import { acceptedRsvp, rsvpInvitation } from "./public-rsvp.fixtures";
import {
  changePartyMode,
  createRsvpDraft,
  restoreSavedDraft,
  sameAttendance,
  sessionOptions,
  toRsvpRequest,
  validateRsvpDraft,
} from "./public-rsvp-state";

const uniform = {
  ...acceptedRsvp,
  partyMode: "FAMILY" as const,
  eventSelections: acceptedRsvp.eventSelections.map((item) => ({
    ...item,
    expectedAttendeeCount: 4,
  })),
};

describe("conditional RSVP draft", () => {
  it("starts unanswered and requires a session and party before accepting", () => {
    const draft = createRsvpDraft(null);
    expect(draft.status).toBe("");
    expect(draft.sessionIds).toEqual([]);
    expect(draft.namedInviteeIds).toEqual([]);
    expect(validateRsvpDraft(draft, rsvpInvitation)).toMatch(/choose whether/);
    expect(
      validateRsvpDraft({ ...draft, status: "ACCEPTED" }, rsvpInvitation),
    ).toMatch(/wedding sessions/);
    expect(() => toRsvpRequest({ ...draft, status: "ACCEPTED" }, null)).toThrow(
      "party choice",
    );
  });
  it("uses configured labels and stable IDs without classifying the names", () => {
    const [ceremony, reception] = rsvpInvitation.events;
    expect(sessionOptions([reception!, ceremony!])).toEqual([
      { label: "Reception", ids: ["event-2"] },
      { label: "Holy Matrimony", ids: ["event-1"] },
      { label: "Reception & Holy Matrimony", ids: ["event-2", "event-1"] },
    ]);
    expect(sessionOptions([reception!])).toEqual([
      { label: "Reception", ids: ["event-2"] },
    ]);
    expect(
      sessionOptions([ceremony!, { id: "other", name: "Dinner" }])[2],
    ).toEqual({ label: "Holy Matrimony & Dinner", ids: ["event-1", "other"] });
    expect(sessionOptions([ceremony!, { ...ceremony! }])).toEqual([]);
    expect(
      sessionOptions([ceremony!, reception!, { id: "other", name: "Dinner" }]),
    ).toEqual([]);
    expect(
      sessionOptions([
        { id: "c", slug: "pemberkatan", name: "Church service" },
        { id: "r", slug: "resepsi", name: "Dinner" },
      ]).map(({ ids }) => ids),
    ).toEqual([["c"], ["r"], ["c", "r"]]);
  });
  it("reopens an explicit family with the exact identities, quantities and sessions", () => {
    const draft = restoreSavedDraft(rsvpInvitation, uniform)!;
    expect(draft).toMatchObject({
      partyMode: "FAMILY",
      namedInviteeIds: ["invitee-1"],
      additionalChildren: 2,
      plusOne: true,
      dietaryNotes: "No seafood",
    });
    expect(toRsvpRequest(draft, 7)).toEqual({
      status: "ACCEPTED",
      partyMode: "FAMILY",
      expectedVersion: 7,
      attendees: uniform.attendees,
      eventSelections: uniform.eventSelections,
      dietaryNotes: "No seafood",
    });
    expect(
      sameAttendance({ ...draft, dietaryNotes: "Different notes" }, draft),
    ).toBe(true);
  });
  it("recognizes a saved family of one without guessing Alone", () => {
    const saved = {
      ...uniform,
      attendeeQuantityTotal: 1,
      attendees: [uniform.attendees[0]!],
      eventSelections: uniform.eventSelections.map((event) => ({
        ...event,
        expectedAttendeeCount: 1,
      })),
    };
    expect(restoreSavedDraft(rsvpInvitation, saved)?.partyMode).toBe("FAMILY");
  });
  it("treats unequal counts, unnamed companions and missing identities as unsupported", () => {
    expect(
      restoreSavedDraft(rsvpInvitation, {
        ...acceptedRsvp,
        partyMode: "FAMILY",
      }),
    ).toBeNull();
    expect(
      restoreSavedDraft(rsvpInvitation, {
        ...uniform,
        attendees: [
          { type: "UNNAMED_COMPANION", inviteeId: null, quantity: 4 },
        ],
      }),
    ).toBeNull();
    expect(
      restoreSavedDraft(rsvpInvitation, { ...uniform, partyMode: undefined }),
    ).toBeNull();
    expect(
      restoreSavedDraft({ ...rsvpInvitation, invitees: [] }, uniform),
    ).toBeNull();
  });
  it("preserves selected identity by ID with reordered inputs", () => {
    const second = {
      id: "adult-2",
      fullName: "Second adult",
      category: "ADULT" as const,
    };
    const invitation = {
      ...rsvpInvitation,
      invitees: [...rsvpInvitation.invitees, second].reverse(),
    };
    const draft = changePartyMode(
      { ...createRsvpDraft(null), status: "ACCEPTED", sessionIds: ["event-2"] },
      invitation,
      "ALONE",
    );
    expect(draft.namedInviteeIds).toEqual([]);
    const selected = { ...draft, namedInviteeIds: [second.id] };
    expect(toRsvpRequest(selected, null).attendees).toEqual([
      { type: "NAMED_INVITEE", inviteeId: second.id, quantity: 1 },
    ]);
  });
  it("handles children without a companion and derives the same count per session", () => {
    const family = {
      ...restoreSavedDraft(rsvpInvitation, uniform)!,
      plusOne: false,
      namedInviteeIds: ["invitee-1", "invitee-2"],
    };
    expect(validateRsvpDraft(family, rsvpInvitation)).toBeNull();
    expect(
      toRsvpRequest(family, 7).eventSelections.map(
        ({ expectedAttendeeCount }) => expectedAttendeeCount,
      ),
    ).toEqual([4, 4]);
  });
  it("clears children and companions when switching branches and keeps decline empty", () => {
    const family = restoreSavedDraft(rsvpInvitation, uniform)!;
    const plusOne = changePartyMode(family, rsvpInvitation, "PLUS_ONE");
    expect(toRsvpRequest(plusOne, 7).attendees.map(({ type }) => type)).toEqual(
      ["NAMED_INVITEE", "PLUS_ONE"],
    );
    const alone = changePartyMode(plusOne, rsvpInvitation, "ALONE");
    expect(toRsvpRequest(alone, 7).attendees).toHaveLength(1);
    expect(toRsvpRequest({ ...family, status: "DECLINED" }, 7)).toEqual({
      expectedVersion: 7,
      status: "DECLINED",
      attendees: [],
      eventSelections: [],
      dietaryNotes: null,
    });
  });
  it("rejects stale allowances and invalid counts without changing data", () => {
    const family = restoreSavedDraft(rsvpInvitation, uniform)!;
    for (const additionalChildren of [-1, 1.5, 3, Number.NaN]) {
      expect(
        validateRsvpDraft({ ...family, additionalChildren }, rsvpInvitation),
      ).toMatch(/additional children/);
    }
    expect(
      validateRsvpDraft(family, {
        ...rsvpInvitation,
        rules: { ...rsvpInvitation.rules, allowPlusOne: false },
      }),
    ).toMatch(/additional companion/);
    expect(
      validateRsvpDraft(
        { ...family, dietaryNotes: "x".repeat(501) },
        rsvpInvitation,
      ),
    ).toMatch(/500/);
  });
});
