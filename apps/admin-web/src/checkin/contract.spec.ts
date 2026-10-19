import { describe, expect, it } from "vitest";
import { isManualStatus, isPreview, isReceipt, isSearch } from "./contract";
const id = "11111111-1111-4111-8111-111111111111";
const candidate = {
  invitation: { id, displayName: "Synthetic household" },
  event: { id, name: "Reception" },
  expectedAttendeeCount: 3,
  alreadyCheckedIn: false,
};
describe("check-in runtime contract", () => {
  it("rejects incoherent recovery and duplicate status, rather than enabling a confirm", () => {
    expect(
      isManualStatus({
        status: "NOT_CONFIRMED",
        alreadyCheckedIn: true,
        previousCheckin: null,
      }),
    ).toBe(false);
    expect(
      isPreview({
        ...candidate,
        status: "ALREADY_CONFIRMED",
        previousCheckin: null,
      }),
    ).toBe(false);
    expect(
      isPreview({ ...candidate, status: "VALID", previousCheckin: null }),
    ).toBe(true);
  });
  it("rejects malformed counts, search overflow, and missing operator attribution", () => {
    expect(
      isSearch({ items: [{ ...candidate, expectedAttendeeCount: 1.5 }] }),
    ).toBe(false);
    expect(
      isSearch({ items: Array.from({ length: 11 }, () => candidate) }),
    ).toBe(false);
    expect(
      isReceipt({
        checkinRecord: {
          id,
          method: "QR",
          attendeeCount: 2,
          checkedInAt: new Date().toISOString(),
        },
      }),
    ).toBe(false);
  });
});
