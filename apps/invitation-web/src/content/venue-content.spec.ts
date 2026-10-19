import { describe, expect, it } from "vitest";
import {
  formatRundownInstant,
  isRundownInstant,
  parseParkingDocument,
  parseRundownDocument,
  selectVenueContent,
  venuePreviewEnabled,
} from "./venue-content";

const reception = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Reception",
};
const ceremony = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ceremony",
};
export function parkingFixture() {
  return {
    schemaVersion: 1,
    status: "published",
    guides: [
      {
        eventId: reception.id,
        title: "Guest parking",
        instructions: ["Follow the venue signs."],
        mapImage: null,
        guidePdf: null,
        googleMapsUrl: null,
      },
    ],
  };
}
export function rundownFixture() {
  return {
    schemaVersion: 1,
    status: "published",
    timeZone: "Asia/Jakarta",
    schedules: [
      {
        eventId: reception.id,
        title: "Guest schedule",
        items: [
          {
            startsAt: "2027-01-09T04:30:00Z",
            title: "Guest arrival",
            description: "",
          },
          {
            startsAt: "2027-01-09T12:00:00+07:00",
            title: "Reception",
            description: "Welcome",
          },
        ],
      },
    ],
  };
}
describe("venue content validation and eligibility", () => {
  it("only projects published eligible events and preserves the API's event names", () => {
    const p = parkingFixture();
    p.guides.push({
      ...p.guides[0]!,
      eventId: ceremony.id,
      title: "INELIGIBLE",
    });
    const documents = {
      parking: parseParkingDocument(p),
      rundown: parseRundownDocument(rundownFixture()),
    };
    const selected = selectVenueContent(documents, [reception]);
    expect(selected.parking).toHaveLength(1);
    expect(selected.parking[0]?.eventName).toBe("Reception");
    expect(JSON.stringify(selected)).not.toContain("INELIGIBLE");
    expect(selectVenueContent(documents, [])).toEqual({
      parking: [],
      rundown: [],
    });
  });
  it("never exposes drafts to guest projection, even when their event IDs match", () => {
    const p = parkingFixture(),
      r = rundownFixture();
    p.status = r.status = "draft";
    const documents = {
      parking: parseParkingDocument(p),
      rundown: parseRundownDocument(r),
    };
    expect(selectVenueContent(documents, [reception])).toEqual({
      parking: [],
      rundown: [],
    });
    expect(
      selectVenueContent(documents, [reception], reception.id).parking,
    ).toHaveLength(1);
  });
  it("allows an unbound draft only in the explicitly selected synthetic preview", () => {
    const p = {
      ...parkingFixture(),
      status: "draft",
      guides: [{ ...parkingFixture().guides[0], eventId: null }],
    };
    const documents = { parking: parseParkingDocument(p), rundown: null };
    expect(documents.parking).not.toBeNull();
    expect(selectVenueContent(documents, [reception]).parking).toEqual([]);
    expect(
      selectVenueContent(documents, [reception], reception.id).parking,
    ).toHaveLength(1);
    expect(selectVenueContent(documents, [], reception.id).parking).toEqual([]);
    expect(parseParkingDocument({ ...p, status: "published" })).toBeNull();
  });
  it.each([
    { NODE_ENV: "production", VENUE_CONTENT_PREVIEW: "1" },
    { NODE_ENV: "test", VENUE_CONTENT_PREVIEW: "1" },
    { NODE_ENV: "development" },
    { NODE_ENV: "development", VENUE_CONTENT_PREVIEW: "true" },
  ])("disables preview outside explicit development opt-in: %j", (env) => {
    expect(venuePreviewEnabled(env)).toBe(false);
  });
  it("enables preview only in development with the flag", () => {
    expect(
      venuePreviewEnabled({
        NODE_ENV: "development",
        VENUE_CONTENT_PREVIEW: "1",
      }),
    ).toBe(true);
  });
  it.each([
    "/assets/venue/../secret.png",
    "/assets/venue/%2e%2e/secret.png",
    "//attacker.test/map.png",
    "https://attacker.test/map.png",
    "/assets/venue/map.svg",
    "/assets/venue/map.html",
    "/assets/venue/map.png?token=secret",
  ])("rejects noncanonical/active image paths: %s", (src) => {
    const p = parkingFixture();
    const guide = { ...p.guides[0], mapImage: { src, alt: "Map description" } };
    expect(parseParkingDocument({ ...p, guides: [guide] })).toBeNull();
  });
  it.each([
    "javascript:alert(1)",
    "http://www.google.com/maps/place/a",
    "https://www.google.com.attacker.test/maps/a",
    "https://user:password@www.google.com/maps/a",
    "https://www.google.com:444/maps/a",
    "https://www.google.com/search?q=maps",
  ])("rejects unsafe/unapproved map URLs: %s", (googleMapsUrl) => {
    const p = parkingFixture();
    expect(
      parseParkingDocument({
        ...p,
        guides: [{ ...p.guides[0], googleMapsUrl }],
      }),
    ).toBeNull();
  });
  it("accepts canonical passive asset paths and approved HTTPS maps URLs", () => {
    const p = parkingFixture();
    expect(
      parseParkingDocument({
        ...p,
        guides: [
          {
            ...p.guides[0],
            mapImage: {
              src: "/assets/venue/parking-map.webp",
              alt: "Entrance and parking",
            },
            guidePdf: "/assets/venue/parking-guide.pdf",
            googleMapsUrl: "https://www.google.com/maps/place/example",
          },
        ],
      }),
    ).not.toBeNull();
  });
  it("rejects duplicate event guides, unknown fields, blank copy and excessive entries", () => {
    const p = parkingFixture();
    expect(
      parseParkingDocument({ ...p, guides: [p.guides[0], p.guides[0]] }),
    ).toBeNull();
    expect(parseParkingDocument({ ...p, privateNote: "internal" })).toBeNull();
    expect(
      parseParkingDocument({
        ...p,
        guides: [{ ...p.guides[0], instructions: [" "] }],
      }),
    ).toBeNull();
    expect(
      parseParkingDocument({ ...p, guides: Array(21).fill(p.guides[0]) }),
    ).toBeNull();
    expect(
      parseParkingDocument({
        ...p,
        guides: [{ ...p.guides[0], title: "x".repeat(121) }],
      }),
    ).toBeNull();
  });
  it.each([
    "2027-02-30T11:30:00+07:00",
    "2027-01-09T11:30:00",
    "2027-01-09T24:00:00Z",
    "2027-01-09T11:60:00Z",
    "2027-01-09T11:30:00+14:30",
    "not-a-date",
  ])("rejects invalid or timezone-less instants: %s", (value) => {
    expect(isRundownInstant(value)).toBe(false);
    const r = rundownFixture();
    r.schedules[0]!.items[0]!.startsAt = value;
    expect(parseRundownDocument(r)).toBeNull();
  });
  it("rejects reversed time order, unsupported timezone and unpublished IDs", () => {
    const r = rundownFixture();
    r.schedules[0]!.items.reverse();
    expect(parseRundownDocument(r)).toBeNull();
    expect(
      parseRundownDocument({ ...rundownFixture(), timeZone: "UTC" }),
    ).toBeNull();
    expect(
      parseRundownDocument({
        ...rundownFixture(),
        schedules: [{ ...rundownFixture().schedules[0], eventId: null }],
      }),
    ).toBeNull();
  });
  it("formats both UTC and offset inputs in Jakarta, including midnight crossing", () => {
    expect(formatRundownInstant("2027-01-09T04:30:00Z")).toEqual({
      day: "09 Jan 2027",
      time: "11.30 WIB",
    });
    expect(formatRundownInstant("2027-01-09T11:30:00+07:00")).toEqual({
      day: "09 Jan 2027",
      time: "11.30 WIB",
    });
    expect(formatRundownInstant("2027-01-09T18:00:00Z")).toEqual({
      day: "10 Jan 2027",
      time: "01.00 WIB",
    });
  });
});
