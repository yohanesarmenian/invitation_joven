import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  codePointCount,
  prepareOverridePayload,
} from "../components/rsvp-override-form";
import { overrideRsvp } from "../src/rsvps/override";
import { auth, failure, json } from "./fixtures";
import { detail as invitationDetail } from "./invitation-fixtures";
import { rsvpDetail } from "./rsvp-fixtures";

const NativeRequest = Request;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === "string"
            ? new URL(input, "http://localhost:3001")
            : input,
          init,
        );
      }
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it("builds exact accepted override payload from the loaded RSVP version", () => {
  const event = invitationDetail.invitation.eligibility[0]!.event;
  const body = prepareOverridePayload({
    rsvp: rsvpDetail.rsvp,
    status: "ACCEPTED",
    selectedNamedIds: [invitationDetail.invitation.invitees[0]!.id],
    plusOneQuantity: "1",
    childQuantity: "2",
    eventFields: {
      [event.id]: { attending: true, expectedAttendeeCount: "4" },
    },
    dietaryNotes: "  Vegetarian  ",
    overrideReason: "  Guest called owner  ",
  }).body;

  expect(body).toEqual({
    attendees: [
      {
        inviteeId: invitationDetail.invitation.invitees[0]!.id,
        quantity: 1,
        type: "NAMED_INVITEE",
      },
      { inviteeId: null, quantity: 1, type: "PLUS_ONE" },
      { inviteeId: null, quantity: 2, type: "ADDITIONAL_CHILD" },
    ],
    dietaryNotes: "Vegetarian",
    eventSelections: [
      { attending: true, eventId: event.id, expectedAttendeeCount: 4 },
    ],
    expectedVersion: rsvpDetail.rsvp.version,
    overrideReason: "Guest called owner",
    status: "ACCEPTED",
  });
  expect(JSON.stringify(body)).not.toContain("guestNote");
  expect(JSON.stringify(body)).not.toContain("adminUser");
  expect(JSON.stringify(body)).not.toContain("checkinPass");
});

it("builds declined override without guest note or attendee state", () => {
  const prepared = prepareOverridePayload({
    rsvp: rsvpDetail.rsvp,
    status: "DECLINED",
    selectedNamedIds: [invitationDetail.invitation.invitees[0]!.id],
    plusOneQuantity: "1",
    childQuantity: "2",
    eventFields: {
      [invitationDetail.invitation.eligibility[0]!.event.id]: {
        attending: true,
        expectedAttendeeCount: "4",
      },
    },
    dietaryNotes: "ignored",
    overrideReason: "Guest declined by phone",
  });
  expect(prepared.errors).toEqual({});
  expect(prepared.body).toEqual({
    attendees: [],
    dietaryNotes: null,
    eventSelections: [],
    expectedVersion: rsvpDetail.rsvp.version,
    overrideReason: "Guest declined by phone",
    status: "DECLINED",
  });
});

it("validates reason with Unicode code points", () => {
  expect(codePointCount("😀".repeat(500))).toBe(500);
  expect(
    prepareOverridePayload({
      rsvp: rsvpDetail.rsvp,
      status: "DECLINED",
      selectedNamedIds: [],
      plusOneQuantity: "0",
      childQuantity: "0",
      eventFields: {},
      dietaryNotes: "",
      overrideReason: "😀".repeat(500),
    }).errors,
  ).toEqual({});
  expect(
    prepareOverridePayload({
      rsvp: rsvpDetail.rsvp,
      status: "DECLINED",
      selectedNamedIds: [],
      plusOneQuantity: "0",
      childQuantity: "0",
      eventFields: {},
      dietaryNotes: "",
      overrideReason: "😀".repeat(501),
    }).errors.reason,
  ).toBe("Reason must be 500 characters or fewer.");
  expect(
    prepareOverridePayload({
      rsvp: rsvpDetail.rsvp,
      status: "DECLINED",
      selectedNamedIds: [],
      plusOneQuantity: "0",
      childQuantity: "0",
      eventFields: {},
      dietaryNotes: "",
      overrideReason: "   ",
    }).errors.reason,
  ).toBe("Enter an override reason.");
});

it("sends one generated override PUT with CSRF and no retry headers", async () => {
  const body = {
    attendees: [],
    dietaryNotes: null,
    eventSelections: [],
    expectedVersion: rsvpDetail.rsvp.version,
    overrideReason: "Guest declined by phone",
    status: "DECLINED" as const,
  };
  fetchMock.mockResolvedValue(json(rsvpDetail));
  expect(
    await overrideRsvp(rsvpDetail.rsvp.invitation.id, body, "csrf-token"),
  ).toMatchObject({ kind: "overridden" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.method).toBe("PUT");
  expect(req.url).toBe(
    `http://localhost:3001/api/admin/invitations/${rsvpDetail.rsvp.invitation.id}/rsvp`,
  );
  expect(req.headers.get("x-csrf-token")).toBe("csrf-token");
  expect(req.headers.has("idempotency-key")).toBe(false);
  expect(await req.json()).toEqual(body);
});

it("maps conflict, validation, uncertain outcomes, and CSRF without replay", async () => {
  const body = {
    attendees: [],
    dietaryNotes: null,
    eventSelections: [],
    expectedVersion: rsvpDetail.rsvp.version,
    overrideReason: "Guest declined by phone",
    status: "DECLINED" as const,
  };
  fetchMock.mockResolvedValueOnce(failure("RSVP_VERSION_CONFLICT", 409));
  expect(await overrideRsvp(rsvpDetail.rsvp.invitation.id, body, "csrf")).toEqual({
    kind: "conflict",
  });
  fetchMock.mockResolvedValueOnce(failure("VALIDATION_ERROR", 400));
  expect(await overrideRsvp(rsvpDetail.rsvp.invitation.id, body, "csrf")).toEqual({
    kind: "validation",
  });
  fetchMock.mockResolvedValueOnce(failure("INTERNAL_ERROR", 500));
  expect(await overrideRsvp(rsvpDetail.rsvp.invitation.id, body, "csrf")).toEqual({
    kind: "uncertain",
  });
  fetchMock
    .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
    .mockResolvedValueOnce(json(auth));
  expect(
    await overrideRsvp(rsvpDetail.rsvp.invitation.id, body, "old"),
  ).toMatchObject({ kind: "csrf", csrfToken: auth.csrfToken });
  expect(fetchMock.mock.calls.map((call) => call[0].method)).toEqual([
    "PUT",
    "PUT",
    "PUT",
    "PUT",
    "GET",
  ]);
});
