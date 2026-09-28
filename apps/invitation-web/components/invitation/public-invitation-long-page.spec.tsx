import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicInvitationLongPage } from "./public-invitation-long-page.js";
import type { PublicInvitationResponse } from "../../../../packages/api-client/src/index.js";

const DUMMY_CREDENTIAL = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbC";

function renderInvitation(
  invitation: Partial<PublicInvitationResponse["invitation"]> = {},
) {
  const baseInvitation = {
    displayName: "The Example Household",
    events: [
      {
        address: "Second venue address",
        googleMapsUrl: "https://maps.example/reception",
        id: "22222222-2222-4222-8222-222222222222",
        name: "Zulu Reception",
        slug: "z-reception",
        startsAt: "2027-01-09T05:00:00.000Z",
        venueName: "Reception Venue",
      },
      {
        address: "First venue address",
        googleMapsUrl: null,
        id: "11111111-1111-4111-8111-111111111111",
        name: "Alpha Holy Matrimony",
        slug: "a-holy-matrimony",
        startsAt: "2027-01-09T01:00:00.000Z",
        venueName: "Chapel Venue",
      },
    ],
    greetingName: "Example Guests",
    invitees: [
      {
        category: "ADULT",
        fullName: "Private Invitee",
        id: "33333333-3333-4333-8333-333333333333",
      },
    ],
    rsvp: {
      status: "PENDING",
      version: 9,
    },
    rsvpDeadlineAt: "2026-12-25T00:00:00.000Z",
    rules: {
      allowPlusOne: true,
      maxAdditionalChildren: 2,
    },
    ...invitation,
  } satisfies PublicInvitationResponse["invitation"];

  return renderToStaticMarkup(
    createElement(PublicInvitationLongPage, { invitation: baseInvitation }),
  );
}

describe("PublicInvitationLongPage", () => {
  it("renders the locked long-page section order", () => {
    const html = renderInvitation();
    const orderedText = [
      "Example Guests",
      '<h3 id="bride-title">Angelina Desandra Adventa</h3>',
      '<h3 id="groom-title">Yohanes Armenian Putra</h3>',
      "Saturday",
      "09 January 2027",
      "Wedding Events",
      "Dress Code",
      "RSVP &amp; Dietary Information",
      "Kindly reply by 25 December 2026.",
      "Pre-wedding Gallery",
      "1 John 4:19",
      "Happiness is only real when shared",
      "Leave a Message",
      "See you at the Wedding!",
      "Handcrafted with love by Angelina &amp; Yohanes",
    ];

    const positions = orderedText.map((text) => html.indexOf(text));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("preserves API event order without sorting by name, slug, or UUID", () => {
    const html = renderInvitation();

    expect(html.indexOf("Zulu Reception")).toBeLessThan(
      html.indexOf("Alpha Holy Matrimony"),
    );
  });

  it("renders Holy Matrimony startsAt as Asia/Jakarta HH.mm event time", () => {
    const html = renderInvitation({
      events: [
        {
          address: "Church address",
          googleMapsUrl: null,
          id: "11111111-1111-4111-8111-111111111111",
          name: "Holy Matrimony",
          slug: "holy-matrimony",
          startsAt: "2027-01-09T01:00:00.000Z",
          venueName: "Church",
        },
      ],
    });

    expect(html).toContain(
      '<time dateTime="2027-01-09T01:00:00.000Z">08.00</time>',
    );
    expect(html).not.toContain(">2027-01-09</time>");
  });

  it("renders reception startsAt as Asia/Jakarta HH.mm event time", () => {
    const html = renderInvitation({
      events: [
        {
          address: "Reception address",
          googleMapsUrl: null,
          id: "22222222-2222-4222-8222-222222222222",
          name: "Wedding Reception",
          slug: "wedding-reception",
          startsAt: "2027-01-09T05:00:00.000Z",
          venueName: "Reception Venue",
        },
      ],
    });

    expect(html).toContain(
      '<time dateTime="2027-01-09T05:00:00.000Z">12.00</time>',
    );
  });

  it("uses explicit Asia/Jakarta conversion across UTC date boundaries", () => {
    const html = renderInvitation({
      events: [
        {
          address: null,
          googleMapsUrl: null,
          id: "55555555-5555-4555-8555-555555555555",
          name: "Boundary Event",
          slug: "boundary-event",
          startsAt: "2027-01-08T18:30:00.000Z",
          venueName: null,
        },
      ],
    });

    expect(html).toContain(
      '<time dateTime="2027-01-08T18:30:00.000Z">01.30</time>',
    );
    expect(html).not.toContain(">18.30</time>");
  });

  it("handles nullable event fields without broken text or map links", () => {
    const html = renderInvitation({
      events: [
        {
          address: null,
          googleMapsUrl: null,
          id: "44444444-4444-4444-8444-444444444444",
          name: "Quiet Ceremony",
          slug: "quiet-ceremony",
          startsAt: null,
          venueName: null,
        },
      ],
    });

    expect(html).toContain("Quiet Ceremony");
    expect(html).not.toContain("Invalid Date");
    expect(html).not.toContain("null");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("View in Google Maps");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<time");
  });

  it("renders map links only when googleMapsUrl is present", () => {
    const html = renderInvitation();

    expect(html).toContain('href="https://maps.example/reception"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html.match(/View in Google Maps/g)).toHaveLength(1);
  });

  it("falls back from greetingName to displayName without placeholders or honorifics", () => {
    const html = renderInvitation({
      displayName: "Fallback Household",
      greetingName: null,
    });

    expect(html).toContain("Fallback Household");
    expect(html).not.toContain("Example Guests");
    expect(html).not.toContain("[");
    expect(html).not.toContain("Mr.");
    expect(html).not.toContain("Mrs.");
  });

  it("renders RSVP deadline only from API data", () => {
    const withDeadline = renderInvitation({
      rsvpDeadlineAt: "2026-12-25T00:00:00.000Z",
    });
    const withoutDeadline = renderInvitation({ rsvpDeadlineAt: null });

    expect(withDeadline).toContain("Kindly reply by 25 December 2026.");
    expect(withoutDeadline).not.toContain("Kindly reply by");
    expect(withoutDeadline).not.toContain("25 December 2026");
  });

  it("does not render functional RSVP or message controls", () => {
    const html = renderInvitation();

    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('role="textbox"');
    expect(html).not.toContain("Joyfully Accept");
    expect(html).not.toContain("Regretfully Decline");
    expect(html).not.toContain("Bring someone special");
    expect(html).not.toContain("Send Confirmation");
    expect(html).not.toContain("Send Message");
  });

  it("does not render credentials, raw IDs, RSVP version, or private fields", () => {
    const html = renderInvitation();

    expect(html).not.toContain(DUMMY_CREDENTIAL);
    expect(html).not.toContain("22222222-2222-4222-8222-222222222222");
    expect(html).not.toContain("33333333-3333-4333-8333-333333333333");
    expect(html).not.toContain("z-reception");
    expect(html).not.toContain("PENDING");
    expect(html).not.toContain("version");
    expect(html).not.toContain("allowPlusOne");
    expect(html).not.toContain("maxAdditionalChildren");
    expect(html).not.toContain("publicTokenHash");
    expect(html).not.toContain("publicTokenVersion");
    expect(html).not.toContain("openCount");
    expect(html).not.toContain("firstOpenedAt");
    expect(html).not.toContain("lastOpenedAt");
  });

  it("renders the 4B0 mock Bride and Groom from local assets", () => {
    const html = renderInvitation();

    expect(html).toContain('src="/assets/mock/bride.svg"');
    expect(html).toContain('src="/assets/mock/groom.svg"');
    expect(html.indexOf("/assets/mock/bride.svg")).toBeLessThan(
      html.indexOf("/assets/mock/groom.svg"),
    );
  });

  it("renders all four 4B0 mock gallery assets in the mosaic", () => {
    const html = renderInvitation();

    for (const asset of [
      "gallery-01",
      "gallery-02",
      "gallery-03",
      "gallery-04",
    ]) {
      expect(html).toContain(`src="/assets/mock/${asset}.svg"`);
    }
  });

  it("keeps every installed image on a local mock path and decorative", () => {
    const html = renderInvitation();
    const images = html.match(/<img[^>]*>/g) ?? [];

    expect(images).toHaveLength(6);

    for (const image of images) {
      expect(image).toMatch(/src="\/assets\/mock\/[a-z0-9-]+\.svg"/);
      expect(image).toContain('alt=""');
      expect(image).not.toContain("http");
      expect(image).toContain('data-nimg="fill"');
    }
  });

  it("maps the Bride role to Angelina Desandra Adventa with the Venta nickname", () => {
    const html = renderInvitation();

    expect(html).toContain(
      '<h3 id="bride-title">Angelina Desandra Adventa</h3>',
    );
    expect(html).toContain('<p class="couple-nickname">Venta</p>');
  });

  it("maps the Groom role to Yohanes Armenian Putra with the Jo nickname", () => {
    const html = renderInvitation();

    expect(html).toContain('<h3 id="groom-title">Yohanes Armenian Putra</h3>');
    expect(html).toContain('<p class="couple-nickname">Jo</p>');
  });

  it("orders the Bride before the Groom and keeps both image roles matched", () => {
    const html = renderInvitation();

    expect(html.indexOf('id="bride-title"')).toBeLessThan(
      html.indexOf('id="groom-title"'),
    );
    expect(html.indexOf('class="couple-media-slot"')).toBeLessThan(
      html.indexOf("/assets/mock/bride.svg"),
    );
    expect(html.indexOf("/assets/mock/bride.svg")).toBeLessThan(
      html.indexOf("/assets/mock/groom.svg"),
    );
  });

  it("keeps the wedding date above the events with a day and date hierarchy", () => {
    const html = renderInvitation();

    expect(html).toContain('<p class="wedding-date-day">Saturday</p>');
    expect(html).toContain('<h2 id="wedding-date-title">09 January 2027</h2>');
    expect(html.indexOf('id="wedding-date-title"')).toBeLessThan(
      html.indexOf("Wedding Events"),
    );
  });

  it("keeps 1 John 4:19 and the McCandless quote as separate blocks", () => {
    const html = renderInvitation();
    const scriptureIndex = html.indexOf("1 John 4:19");
    const quoteIndex = html.indexOf("Happiness is only real when shared");

    expect(html).not.toContain("Scripture &amp; Words");
    expect(scriptureIndex).toBeGreaterThan(html.indexOf("Pre-wedding Gallery"));
    expect(scriptureIndex).toBeLessThan(quoteIndex);
    expect(html).toContain("<cite>1 John 4:19</cite>");
    expect(html).toContain("<cite>Christopher McCandless</cite>");

    // Separate <blockquote> elements, not one merged quote block.
    const between = html.slice(scriptureIndex, quoteIndex);
    expect(between).toContain("</blockquote>");
    expect(between).toContain("<blockquote>");
  });
});
