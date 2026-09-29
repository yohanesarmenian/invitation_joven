import { describe, expect, it } from "vitest";
import { acceptedRsvp, rsvpInvitation } from "./public-rsvp.fixtures";
import {
  attendeeTotal,
  createRsvpDraft,
  normalizeEventCounts,
  toRsvpRequest,
  validateRsvpDraft,
} from "./public-rsvp-state";

describe("public RSVP form state", () => {
  it("starts unanswered without manufacturing a version or attendance", () => {
    const draft = createRsvpDraft(rsvpInvitation, null);
    expect(draft.status).toBe("");
    expect(attendeeTotal(draft)).toBe(0);
    expect(
      draft.eventSelections.every(
        (event) => !event.attending && event.expectedAttendeeCount === 0,
      ),
    ).toBe(true);
    expect(validateRsvpDraft(draft, rsvpInvitation)).toContain("choose");
    expect(() => toRsvpRequest(draft, null)).toThrow();
  });
  it("maps accepted composition, eligible events and dietary notes", () => {
    const draft = createRsvpDraft(rsvpInvitation, acceptedRsvp);
    expect(attendeeTotal(draft)).toBe(4);
    expect(toRsvpRequest(draft, 7)).toEqual({
      expectedVersion: 7,
      status: "ACCEPTED",
      attendees: acceptedRsvp.attendees,
      eventSelections: acceptedRsvp.eventSelections,
      dietaryNotes: "No seafood",
    });
  });
  it("uses null for first create and the exact server version for updates", () => {
    const draft = createRsvpDraft(rsvpInvitation, acceptedRsvp);
    expect(toRsvpRequest(draft, null).expectedVersion).toBeNull();
    expect(toRsvpRequest(draft, 23).expectedVersion).toBe(23);
  });
  it("keeps legacy PENDING unanswered while allowing its persisted version", () => {
    const draft = createRsvpDraft(rsvpInvitation, {
      ...acceptedRsvp,
      status: "PENDING",
    });
    expect(draft.status).toBe("");
    expect(
      toRsvpRequest({ ...draft, status: "DECLINED" }, 7).expectedVersion,
    ).toBe(7);
  });
  it("declined server state never activates stale accepted values", () => {
    const draft = createRsvpDraft(rsvpInvitation, {
      ...acceptedRsvp,
      status: "DECLINED",
    });
    expect(draft.status).toBe("DECLINED");
    expect(attendeeTotal(draft)).toBe(0);
    expect(draft.dietaryNotes).toBe("");
    expect(draft.eventSelections.every((event) => !event.attending)).toBe(true);
  });
  it("decline creates clean arrays/null without destroying the accepted draft", () => {
    const draft = createRsvpDraft(rsvpInvitation, acceptedRsvp);
    expect(toRsvpRequest({ ...draft, status: "DECLINED" }, 7)).toEqual({
      expectedVersion: 7,
      status: "DECLINED",
      attendees: [],
      eventSelections: [],
      dietaryNotes: null,
    });
    expect(draft.dietaryNotes).toBe("No seafood");
    expect(attendeeTotal(draft)).toBe(4);
  });
  it("blocks accepted state without attendees", () => {
    expect(
      validateRsvpDraft(
        { ...createRsvpDraft(rsvpInvitation, null), status: "ACCEPTED" },
        rsvpInvitation,
      ),
    ).toContain("person");
  });
  it("blocks accepted state without an attending event", () => {
    const draft = createRsvpDraft(rsvpInvitation, acceptedRsvp);
    draft.eventSelections = draft.eventSelections.map((event) => ({
      ...event,
      attending: false,
      expectedAttendeeCount: 0,
    }));
    expect(validateRsvpDraft(draft, rsvpInvitation)).toContain(
      "at least one event",
    );
  });
  it.each([0, -1, 1.5, 5, NaN])(
    "rejects invalid attending count %s",
    (count) => {
      const draft = createRsvpDraft(rsvpInvitation, acceptedRsvp);
      draft.eventSelections[0]!.expectedAttendeeCount = count;
      expect(validateRsvpDraft(draft, rsvpInvitation)).toContain("event count");
    },
  );
  it("supports differing counts and sends zero on deselection", () => {
    const draft = createRsvpDraft(rsvpInvitation, acceptedRsvp);
    expect(validateRsvpDraft(draft, rsvpInvitation)).toBeNull();
    draft.eventSelections[0]!.attending = false;
    const normalized = normalizeEventCounts(draft);
    expect(toRsvpRequest(normalized, 7).eventSelections[0]).toEqual({
      eventId: "event-1",
      attending: false,
      expectedAttendeeCount: 0,
    });
    expect(normalized.eventSelections[1]!.expectedAttendeeCount).toBe(2);
  });
  it("reduces event counts when composition shrinks and restores a minimum", () => {
    const draft = createRsvpDraft(rsvpInvitation, acceptedRsvp);
    const reduced = normalizeEventCounts({
      ...draft,
      plusOne: false,
      additionalChildren: 0,
    });
    expect(attendeeTotal(reduced)).toBe(1);
    expect(
      reduced.eventSelections.map((event) => event.expectedAttendeeCount),
    ).toEqual([1, 1]);
    const empty = normalizeEventCounts({ ...reduced, namedInviteeIds: [] });
    expect(empty.eventSelections[0]!.expectedAttendeeCount).toBe(0);
    expect(
      normalizeEventCounts({ ...empty, plusOne: true }).eventSelections[0]!
        .expectedAttendeeCount,
    ).toBe(1);
  });
  it.each([-1, 3, 0.5, NaN])(
    "rejects invalid child quantity %s",
    (quantity) => {
      const draft = {
        ...createRsvpDraft(rsvpInvitation, acceptedRsvp),
        additionalChildren: quantity,
      };
      expect(validateRsvpDraft(draft, rsvpInvitation)).toContain(
        "additional children",
      );
    },
  );
  it("allows 500 trimmed characters, blocks 501 and supports clearing", () => {
    const draft = createRsvpDraft(rsvpInvitation, acceptedRsvp);
    draft.dietaryNotes = "x".repeat(500);
    expect(validateRsvpDraft(draft, rsvpInvitation)).toBeNull();
    draft.dietaryNotes += "x";
    expect(validateRsvpDraft(draft, rsvpInvitation)).toContain("500");
    draft.dietaryNotes = "  ";
    expect(toRsvpRequest(draft, 7).dietaryNotes).toBeNull();
    expect(toRsvpRequest(draft, 7)).not.toHaveProperty("guestNote");
  });
  it("takes successful server data as canonical including non-sequential version", () => {
    const server = { ...acceptedRsvp, version: 42, dietaryNotes: "Trimmed" };
    const next = toRsvpRequest(
      createRsvpDraft(rsvpInvitation, server),
      server.version,
    );
    expect(next.expectedVersion).toBe(42);
    expect(next.dietaryNotes).toBe("Trimmed");
  });
});
