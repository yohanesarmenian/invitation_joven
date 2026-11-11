import { describe, expect, it } from "vitest";
import {
  rsvpHistoryDiff,
  sameRsvpValues,
  type RsvpHistoryValues,
} from "./rsvp-history.js";

const saved: RsvpHistoryValues = {
  status: "ACCEPTED",
  dietaryNotes: null,
  submittedByAdminUserId: null,
  overrideReason: null,
  attendees: [
    {
      type: "NAMED_INVITEE",
      inviteeId: "guest-a",
      name: "Synthetic Guest",
      quantity: 1,
    },
    {
      type: "ADDITIONAL_CHILD",
      inviteeId: null,
      name: "Additional children",
      quantity: 2,
    },
  ],
  eventSelections: [
    {
      eventId: "event-a",
      name: "Synthetic wedding",
      attending: true,
      expectedAttendeeCount: 3,
    },
  ],
};

describe("RSVP audit normalization", () => {
  it("ignores row order, labels and equivalent split child quantities for no-ops", () => {
    expect(
      sameRsvpValues(saved, {
        ...saved,
        attendees: [
          { type: "ADDITIONAL_CHILD", inviteeId: null, name: "", quantity: 1 },
          { type: "ADDITIONAL_CHILD", inviteeId: null, name: "", quantity: 1 },
          { ...saved.attendees[0]!, name: "Renamed label" },
        ],
      }),
    ).toBe(true);
  });

  it("records a change of guest identity even when display names are identical", () => {
    const updated = {
      ...saved,
      attendees: [
        { ...saved.attendees[0]!, inviteeId: "guest-b" },
        saved.attendees[1]!,
      ],
    };
    expect(sameRsvpValues(saved, updated)).toBe(false);
    expect(
      rsvpHistoryDiff(saved, updated).map((change) => change.field),
    ).toContain("attendees");
  });

  it("treats omitted and explicit zero-count non-attending events as equivalent", () => {
    const updated = {
      ...saved,
      eventSelections: [
        ...saved.eventSelections,
        {
          eventId: "event-b",
          name: "Not selected",
          attending: false,
          expectedAttendeeCount: 0,
        },
      ],
    };
    expect(sameRsvpValues(saved, updated)).toBe(true);
    expect(rsvpHistoryDiff(saved, updated)).toEqual([]);
  });

  it("records counts, selections, dietary needs, attribution and reason as meaningful state", () => {
    const updated: RsvpHistoryValues = {
      ...saved,
      attendees: [saved.attendees[0]!],
      eventSelections: [
        { ...saved.eventSelections[0]!, expectedAttendeeCount: 1 },
      ],
      dietaryNotes: "Vegetarian",
      submittedByAdminUserId: "synthetic-owner",
      overrideReason: "Guest called reception",
    };
    expect(sameRsvpValues(saved, updated)).toBe(false);
    expect(
      rsvpHistoryDiff(saved, updated).map((change) => change.field),
    ).toEqual([
      "attendees",
      "expectedAttendance",
      "events",
      "dietaryNotes",
      "attribution",
      "overrideReason",
    ]);
    expect(rsvpHistoryDiff(null, saved)).toContainEqual({
      field: "status",
      label: "Attendance",
      before: "Not responded",
      after: "ACCEPTED",
    });
  });
});
