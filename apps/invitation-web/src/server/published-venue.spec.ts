import { afterEach, describe, expect, it, vi } from "vitest";
import { retrievePublishedVenue } from "./published-venue";
const event = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Authoritative Reception",
};
const other = "11111111-1111-4111-8111-111111111111";
const asset = "33333333-3333-4333-8333-333333333333";
const body = {
  parking: {
    title: "Guest parking",
    instructions: ["Use the venue entrance."],
    mapAssetId: asset,
    mapAlt: "Entrance",
    pdfAssetId: null,
    googleMapsUrl: null,
  },
  rundown: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("backend published venue retrieval", () => {
  it("filters other events, uses authoritative names and fixed same-origin asset paths with no-store/no redirect", async () => {
    vi.stubEnv("INVITATION_API_BASE_URL", "http://127.0.0.1:4000");
    const fetch = vi.fn(async (request: Request) => {
      expect(request.cache).toBe("no-store");
      expect(request.redirect).toBe("error");
      return Response.json({
        items: [
          {
            eventId: event.id,
            eventName: "Ignored server name",
            content: body,
          },
          { eventId: other, eventName: "INELIGIBLE", content: body },
        ],
      });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await retrievePublishedVenue("A".repeat(43), [event]);
    expect(result.parking).toHaveLength(1);
    expect(result.parking[0]?.eventName).toBe(event.name);
    expect(result.parking[0]?.mapImage?.src).toBe(
      `/i/${"A".repeat(43)}/venue-assets/${asset}`,
    );
    expect(JSON.stringify(result)).not.toContain("INELIGIBLE");
  });
  it.each(["network", "malformed", "unpublished"])(
    "fails closed without falling back to local published mock files: %s",
    async (mode) => {
      vi.stubEnv("INVITATION_API_BASE_URL", "http://127.0.0.1:4000");
      vi.stubEnv("VENUE_CONTENT_DIRECTORY", "e2e/fixtures/venue");
      vi.stubGlobal("fetch", async () => {
        if (mode === "network") throw new Error("private diagnostic");
        return Response.json(
          mode === "malformed"
            ? { items: [{ content: "invalid" }] }
            : { items: [] },
        );
      });
      expect(await retrievePublishedVenue("A".repeat(43), [event])).toEqual({
        parking: [],
        rundown: [],
      });
    },
  );
});
