import { describe, expect, it } from "vitest";
import { calendarFile, type CalendarEvent } from "./calendar";
import { nextEvent, remainingMinutes } from "./countdown";
const event: CalendarEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ceremony, Jo; Venta\nBEGIN:ATTACK",
  startsAt: "2027-01-09T08:00:00+07:00",
  endsAt: "2027-01-09T09:00:00+07:00",
  venueName: "Synthetic venue",
  address: "Synthetic address",
};
describe("eligible event enhancements", () => {
  it("uses UTC instants, escapes text, folds UTF-8 lines and emits no personal URLs", () => {
    const content = calendarFile(
      { ...event, address: "結婚式".repeat(60) },
      new Date("2026-10-15T00:00:00Z"),
    )!;
    expect(content).toContain(
      "DTSTART:20270109T010000Z\r\nDTEND:20270109T020000Z",
    );
    expect(content).toContain("Ceremony\\, Jo\\; Venta\\nBEGIN:ATTACK");
    for (const line of content.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(content).not.toContain("URL:");
    expect(content).not.toContain("/i/");
    expect(content).not.toContain("qrPayload");
  });
  it("omits unavailable or non-increasing ends and hides undated calendar actions", () => {
    expect(calendarFile({ ...event, startsAt: null })).toBeNull();
    expect(calendarFile({ ...event, startsAt: "invalid" })).toBeNull();
    for (const endsAt of [null, "2027-01-08T00:00:00Z", "invalid"])
      expect(calendarFile({ ...event, endsAt })).not.toContain("DTEND");
  });
  it("chooses the next eligible instant without reordering events and never counts below zero", () => {
    const items = [
      { name: "later", startsAt: "2027-01-10T00:00:00Z" },
      { name: "earlier", startsAt: "2027-01-09T01:00:00Z" },
      { name: "undated", startsAt: null },
    ];
    const now = Date.parse("2027-01-09T00:00:00Z");
    expect(nextEvent(items, now)?.name).toBe("earlier");
    expect(nextEvent(items, Date.parse(items[1]!.startsAt!))?.name).toBe(
      "later",
    );
    expect(nextEvent(items, Date.parse("2028-01-01"))).toBeNull();
    expect(items[0]?.name).toBe("later");
    expect(remainingMinutes(event.startsAt!, now)).toBe(60);
    expect(remainingMinutes(event.startsAt!, Date.parse("2028-01-01"))).toBe(0);
  });
});
