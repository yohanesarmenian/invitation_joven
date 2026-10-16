import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VenueInformation } from "./venue-information";

describe("venue information rendering", () => {
  it("renders a bounded lazy map with descriptive alt and separately labeled PDF/maps links", () => {
    const html = renderToStaticMarkup(
      createElement(VenueInformation, {
        content: {
          parking: [
            {
              eventId: "example",
              eventName: "Reception",
              title: "Parking",
              instructions: ["Follow the signs."],
              mapImage: {
                src: "/assets/venue/map.png",
                alt: "Entrance and guest parking",
              },
              guidePdf: "/assets/venue/guide.pdf",
              googleMapsUrl: "https://www.google.com/maps/place/example",
            },
          ],
          rundown: [],
        },
      }),
    );
    expect(html).toContain('alt="Entrance and guest parking"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('aria-label="Open parking map for Reception"');
    expect(html).toContain("Open parking guide (PDF)");
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("omits empty sections and actions", () => {
    expect(
      renderToStaticMarkup(
        createElement(VenueInformation, {
          content: { parking: [], rundown: [] },
        }),
      ),
    ).toBe("");
  });
  it("escapes copy, labels event-specific regions and renders Jakarta time", () => {
    const html = renderToStaticMarkup(
      createElement(VenueInformation, {
        content: {
          parking: [
            {
              eventId: "example",
              eventName: "Reception",
              title: "<script>bad()</script>",
              instructions: ["Use the entrance."],
              mapImage: null,
              guidePdf: null,
              googleMapsUrl: null,
            },
          ],
          rundown: [
            {
              eventId: "example",
              eventName: "Reception",
              title: "Guest schedule",
              items: [
                {
                  startsAt: "2027-01-09T04:30:00Z",
                  title: "Guest arrival",
                  description: "<img onerror=alert(1)>",
                },
              ],
            },
          ],
        },
      }),
    );
    expect(html).toContain('aria-label="Parking for Reception"');
    expect(html).toContain('aria-label="Rundown for Reception"');
    expect(html).toContain("11.30 WIB");
    expect(html).toContain('dateTime="2027-01-09T04:30:00Z"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img onerror");
    expect(html).not.toContain("<a");
  });
});
