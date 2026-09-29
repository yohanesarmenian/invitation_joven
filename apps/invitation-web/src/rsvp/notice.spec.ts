import { describe, expect, it } from "vitest";
import {
  rsvpFailureNotice,
  rsvpLoadFailureNotice,
  rsvpSuccessNotice,
} from "./notice";
import type { RsvpFailure } from "./result";

function api(httpStatus: number, code: string): RsvpFailure {
  return { kind: "api", httpStatus, code };
}

describe("RSVP result notices", () => {
  it.each(["ACCEPTED", "DECLINED"] as const)(
    "confirms %s and allows editing before the deadline",
    (status) => {
      const notice = rsvpSuccessNotice(status);
      expect(notice.tone).toBe("success");
      expect(notice.message).toContain(
        status === "ACCEPTED"
          ? "acceptance has been saved"
          : "saved as not attending",
      );
      expect(notice.message).toContain("before the reply deadline");
      expect(notice.message).not.toMatch(/QR|pass|ticket|check-in/i);
    },
  );
  it("explains conflict and explicit draft replacement without offering mutation retry", () => {
    const notice = rsvpFailureNotice(api(409, "RSVP_VERSION_CONFLICT"));
    expect(notice.recovery).toBe("reload");
    expect(notice.tone).toBe("conflict");
    expect(notice.message).toContain("Your changes are still here");
    expect(notice.message).toContain("will replace them");
  });
  it("closes RSVP without a retry or hardcoded deadline", () => {
    const notice = rsvpFailureNotice(api(422, "RSVP_DEADLINE_PASSED"));
    expect(notice.title).toBe("RSVP is closed");
    expect(notice.recovery).toBe("none");
    expect(notice.message).not.toMatch(/2026|2027|December|override|contact/);
  });
  it.each([
    ["EVENT_NOT_ALLOWED", "no longer available", "events"],
    ["EVENT_NOT_SELECTED", "at least one event", "events"],
    [
      "PLUS_ONE_NOT_ALLOWED",
      "does not currently include a plus one",
      "attendees",
    ],
    ["ADDITIONAL_CHILD_LIMIT_EXCEEDED", "exceeds this invitation", "attendees"],
    ["RSVP_ATTENDEE_INVALID", "invalid or no longer current", "attendees"],
  ])(
    "maps %s to a correction in the existing section",
    (code, message, section) => {
      const notice = rsvpFailureNotice(api(422, code!));
      expect(notice.message).toContain(message);
      expect(notice.recovery).toBe("correct");
      expect(notice.section).toBe(section);
      expect(JSON.stringify(notice)).not.toContain(code);
    },
  );
  it("maps structural 400 without backend details", () => {
    expect(rsvpFailureNotice(api(400, "VALIDATION_ERROR"))).toMatchObject({
      recovery: "correct",
      section: "attendance",
    });
  });
  it("keeps unavailable copy non-enumerating", () => {
    const notice = rsvpFailureNotice(api(404, "INVITATION_NOT_AVAILABLE"));
    expect(notice.message).toBe("This invitation is no longer available.");
    expect(notice.recovery).toBe("none");
    expect(JSON.stringify(notice)).not.toMatch(
      /archived|expired|token|credential|hash/,
    );
  });
  it.each([
    { kind: "network", httpStatus: null, code: null },
    { kind: "invalid-response", httpStatus: 200, code: null },
    api(500, "INTERNAL_SERVER_ERROR"),
    api(422, "UNKNOWN_CODE"),
    api(422, "constructor"),
    api(500, "RSVP_DEADLINE_PASSED"),
    api(400, "RSVP_VERSION_CONFLICT"),
  ] satisfies RsvpFailure[])("safely maps unexpected failure %#", (failure) => {
    const notice = rsvpFailureNotice(failure);
    expect(notice.tone).toBe("error");
    expect(notice.recovery).toBe(
      failure.httpStatus === 400 ? "correct" : "retry",
    );
    expect(JSON.stringify(notice)).not.toContain(failure.code ?? "__unused__");
  });
  it("preserves a failed conflict reload's replacement warning", () => {
    const notice = rsvpLoadFailureNotice(api(503, "UNEXPECTED"), true);
    expect(notice.recovery).toBe("reload");
    expect(notice.message).toContain("Your changes are still here");
    expect(notice.message).toContain("before submitting");
  });
  it("offers a safe initial GET retry", () => {
    const notice = rsvpLoadFailureNotice(
      { kind: "network", httpStatus: null, code: null },
      false,
    );
    expect(notice.title).toContain("couldn’t be loaded");
    expect(notice.recovery).toBe("reload");
  });
  it("keeps terminal load messages specific", () => {
    expect(
      rsvpLoadFailureNotice(api(404, "INVITATION_NOT_AVAILABLE"), false),
    ).toMatchObject({
      message: "This invitation is no longer available.",
      recovery: "reload",
    });
    expect(
      rsvpLoadFailureNotice(api(422, "RSVP_DEADLINE_PASSED"), true),
    ).toMatchObject({ title: "RSVP is closed", recovery: "none" });
  });
});
