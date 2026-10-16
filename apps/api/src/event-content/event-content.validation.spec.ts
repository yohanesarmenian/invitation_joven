import { describe, expect, it } from "vitest";
import {
  instant,
  parseSave,
  parseVenueBody,
  parseVersionOnly,
} from "./event-content.validation.js";
const body = () => ({
  parking: {
    title: "Parking",
    instructions: ["Use the entrance."],
    mapAssetId: null,
    mapAlt: "",
    pdfAssetId: null,
    googleMapsUrl: null,
  },
  rundown: {
    title: "Schedule",
    items: [
      {
        startsAt: "2027-01-09T11:30:00+07:00",
        title: "Arrival",
        description: "",
      },
    ],
  },
});
describe("venue publication validation", () => {
  it("accepts complete parking/rundown and unfinished but structurally valid drafts", () => {
    expect(parseVenueBody(body(), true)).toEqual(body());
    const unfinished = body();
    unfinished.rundown.items[0]!.startsAt = "";
    unfinished.parking.title = "";
    expect(parseVenueBody(unfinished)).toEqual(unfinished);
    expect(() => parseVenueBody(unfinished, true)).toThrow();
  });
  it.each([
    "2027-02-30T12:00:00+07:00",
    "2027-01-09T12:00:00",
    "2027-01-09T24:00:00Z",
    "2027-01-09T12:00:00+14:30",
  ])("rejects impossible or ambiguous instants: %s", (value) =>
    expect(instant(value)).toBe(false),
  );
  it("rejects reversed published order, empty publication, unknown fields and overlong text", () => {
    const v = body();
    v.rundown.items.push({
      startsAt: "2027-01-09T10:30:00+07:00",
      title: "Before",
      description: "",
    });
    expect(() => parseVenueBody(v, true)).toThrow();
    expect(() =>
      parseVenueBody({ parking: null, rundown: null }, true),
    ).toThrow();
    expect(() =>
      parseVenueBody({ ...body(), internalNote: "private" }),
    ).toThrow();
    expect(() =>
      parseVenueBody({
        ...body(),
        parking: { ...body().parking, title: "x".repeat(121) },
      }),
    ).toThrow();
  });
  it.each([
    "javascript:alert(1)",
    "https://www.google.com.attacker.test/maps/a",
    "https://user:password@www.google.com/maps/a",
    "http://www.google.com/maps/a",
  ])("rejects unsafe map URL: %s", (googleMapsUrl) =>
    expect(() =>
      parseVenueBody({
        ...body(),
        parking: { ...body().parking, googleMapsUrl },
      }),
    ).toThrow(),
  );
  it("requires a bounded integer version and exact mutation fields", () => {
    expect(parseVersionOnly({ expectedVersion: 0 })).toBe(0);
    expect(parseSave({ expectedVersion: 1, content: body() }).version).toBe(1);
    for (const expectedVersion of [
      -1,
      1.5,
      "1",
      null,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => parseVersionOnly({ expectedVersion })).toThrow();
    expect(() =>
      parseVersionOnly({ expectedVersion: 1, extra: true }),
    ).toThrow();
  });
});
