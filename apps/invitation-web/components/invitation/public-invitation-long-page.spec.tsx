import { weddingMedia } from "../../src/presentation/wedding-media";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicInvitationLongPage } from "./public-invitation-long-page.js";
import { GuestMessageForm } from "./guest-message-form";
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
        endsAt: null,
        startsAt: "2027-01-09T05:00:00.000Z",
        venueName: "Reception Venue",
      },
      {
        address: "First venue address",
        googleMapsUrl: null,
        id: "11111111-1111-4111-8111-111111111111",
        name: "Alpha Holy Matrimony",
        slug: "a-holy-matrimony",
        endsAt: null,
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
    createElement(PublicInvitationLongPage, {
      initialNow: Date.parse("2026-10-15T00:00:00Z"),
      invitation: baseInvitation,
      rsvpForm: createElement("div", { "data-rsvp-slot": true }, "RSVP form"),
      guestMessageForm: createElement(GuestMessageForm, {
        submitAction: async () => ({
          status: "success" as const,
          data: { message: { createdAt: "2026-09-30T00:00:00Z" } },
        }),
      }),
    }),
  );
}

describe("PublicInvitationLongPage", () => {
  it("identifies reception and matrimony icons by name rather than API order", () => {
    const html = renderInvitation();
    // The fixture deliberately puts reception before matrimony.
    expect(html.indexOf('data-event-icon="celebration"')).toBeLessThan(
      html.indexOf('data-event-icon="rings"'),
    );
    expect(html).not.toContain("decoration-rings");
  });

  it("uses a neutral icon for an event without an explicit ceremony name", () => {
    const html = renderInvitation({
      events: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          slug: "family-gathering",
          name: "Family Gathering",
          startsAt: null,
          endsAt: null,
          venueName: null,
          address: null,
          googleMapsUrl: null,
        },
      ],
    });
    expect(html).toContain('data-event-icon="calendar"');
    expect(html).not.toContain('data-event-icon="rings"');
    expect(html).not.toContain('data-event-icon="celebration"');
  });

  it("renders the locked long-page section order", () => {
    const html = renderInvitation();
    const orderedText = [
      "Example Guests",
      '<h3 id="bride-title">Angelina Desandra Adventa <span class="couple-nickname">(Venta)</span></h3>',
      '<h3 id="groom-title">Yohanes Armenian Putra <span class="couple-nickname">(Jo)</span></h3>',
      "Saturday",
      "09 January 2027",
      "Wedding Events",
      "Dress Code",
      "RSVP &amp; Dietary Information",
      "Kindly reply by 25 December 2026.",
      "RSVP form",
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
    const rendered = renderInvitation();
    // Countdown independently names the next event; the event-list order is authoritative.
    const html = rendered.slice(rendered.indexOf('class="event-list"'));

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
          endsAt: null,
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
          endsAt: null,
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
          endsAt: null,
          startsAt: "2027-01-08T18:30:00.000Z",
          venueName: null,
        },
      ],
    });

    expect(html).toContain(
      '<time dateTime="2027-01-08T18:30:00.000Z">01.30</time>',
    );
    expect(html).not.toContain(">18.30</time>");
    expect(html).toContain('<h2 id="wedding-date-title">09 January 2027</h2>');
  });

  it("uses the earliest eligible date from the API and hides the date/countdown when all dates are unknown", () => {
    const event = {
      id: "55555555-5555-4555-8555-555555555555",
      slug: "updated-event",
      name: "Updated event",
      startsAt: "2028-02-10T17:30:00Z",
      endsAt: null,
      venueName: null,
      address: null,
      googleMapsUrl: null,
    };
    const html = renderInvitation({
      events: [
        {
          ...event,
          id: "66666666-6666-4666-8666-666666666666",
          startsAt: "2028-02-12T00:00:00Z",
        },
        event,
      ],
    });
    expect(html).toContain('<h2 id="wedding-date-title">11 February 2028</h2>');
    expect(html).toContain('class="wedding-date-day">Friday</p>');
    expect(html).not.toContain("09 January 2027");
    const unknown = renderInvitation({
      events: [{ ...event, startsAt: null }],
    });
    expect(unknown).not.toContain('id="wedding-date-title"');
    expect(unknown).not.toContain('class="event-countdown"');
    expect(unknown).toContain("Updated event");
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
          endsAt: null,
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
    const greeting = html.slice(
      html.indexOf("<header"),
      html.indexOf("</header>"),
    );
    expect(greeting).not.toContain("Mr.");
    expect(greeting).not.toContain("Mrs.");
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

  it("keeps the RSVP slot independent and renders the Phase 7 message form in section 11", () => {
    const html = renderInvitation();

    expect(html).toContain('data-rsvp-slot="true"');
    expect(html).toContain('aria-label="Guest message"');
    expect(html).toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).toContain("<textarea");
    expect(html).toContain("Your name");
    expect(html).toContain("Your message");
    expect(html).not.toContain(
      "Guest messages will be available in a later phase",
    );
    expect(html.indexOf('aria-label="Guest message"')).toBeGreaterThan(
      html.indexOf("Leave a Message"),
    );
    expect(html.indexOf('aria-label="Guest message"')).toBeLessThan(
      html.indexOf("See you at the Wedding!"),
    );
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('role="checkbox"');
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('role="textbox"');
    expect(html).not.toContain("Joyfully Accept");
    expect(html).not.toContain("Regretfully Decline");
    expect(html).not.toContain("Bring someone special");
    expect(html).not.toContain("Send Confirmation");
    expect(html).toContain("Send Message");
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

  it("renders the real Bride and Groom from canonical local assets", () => {
    const html = renderInvitation().replace(
      /(?:src|srcSet)="[^"]*"/g,
      decodeURIComponent,
    );

    expect(html).toContain(weddingMedia.bride);
    expect(html).toContain(weddingMedia.groom);
    expect(html).toContain("Daughter of");
    expect(html).toContain("Mr. Agus Witjaksono");
    expect(html).toContain("&amp; Mrs. Godeliva Yuniati");
    expect(html).toContain("Son of");
    expect(html).toContain("Mr. Eddy Frist Simamora");
    expect(html).toContain("Mrs. Entin Kartini");
    expect(html.indexOf(weddingMedia.bride)).toBeLessThan(
      html.indexOf(weddingMedia.groom),
    );
  });

  it("renders all four real gallery assets in the approved order", () => {
    const html = renderInvitation().replace(
      /(?:src|srcSet)="[^"]*"/g,
      decodeURIComponent,
    );
    const gallery = html.slice(
      html.indexOf('class="gallery-mosaic"'),
      html.indexOf('class="gallery-scripture"'),
    );
    const images = (gallery.match(/<img[^>]*>/g) ?? []).filter((image) =>
      /\/assets\/photography\//.test(image),
    );
    const assets = weddingMedia.gallery.map((image) => image.src);

    expect(images).toHaveLength(4);
    assets.forEach((asset, index) => {
      expect(images[index]).toContain(asset);
    });
  });

  it("keeps all interior photos local, responsive, lazy and decorative", () => {
    const html = renderInvitation().replace(
      /(?:src|srcSet)="[^"]*"/g,
      decodeURIComponent,
    );
    const images = (html.match(/<img[^>]*>/g) ?? []).filter((image) =>
      /\/assets\/photography\//.test(image),
    );

    expect(images).toHaveLength(7);

    for (const image of images) {
      expect(image).toMatch(/\/assets\/photography\/[a-z0-9-]+\.webp/);
      expect(image).not.toContain("/assets/mock/");
      expect(image).toContain('srcSet="');
      expect(image).toContain('sizes="');
      expect(image).toContain('alt=""');
      expect(image).not.toContain("http");
      expect(image).toContain('data-nimg="fill"');
      expect(image).toContain('loading="lazy"');
    }
  });

  it("maps the Bride role to Angelina Desandra Adventa with the Venta nickname", () => {
    const html = renderInvitation();

    expect(html).toContain(
      '<h3 id="bride-title">Angelina Desandra Adventa <span class="couple-nickname">(Venta)</span></h3>',
    );
    expect(html).toContain('<span class="couple-nickname">(Venta)</span>');
  });

  it("renders the local floral sources and shared ornaments as decoration", () => {
    const html = renderInvitation().replace(
      /(?:src|srcSet)="[^"]*"/g,
      decodeURIComponent,
    );
    const decorations = (html.match(/<img[^>]*>/g) ?? []).filter((image) =>
      /long-img(?:Watercolor|Leaves|Calendar|Objects|ChatGpt)/.test(image),
    );

    for (const asset of [
      "WatercolorBloomingFlowers1.png",
      "WatercolorBloomingFlowersCopyCopy1.png",
      "Leaves1.png",
      "Calendar1.png",
      "Objects1.png",
    ]) {
      expect(decorations.some((image) => image.includes(asset))).toBe(true);
    }
    for (const image of decorations) {
      expect(image).toContain('alt=""');
      expect(image).not.toContain("http");
    }
    const wrappers =
      html.match(/<span class="invitation-decoration [^>]*>/g) ?? [];
    expect(wrappers).toHaveLength(decorations.length);
    for (const wrapper of wrappers) {
      expect(wrapper).toContain('aria-hidden="true"');
      expect(wrapper).not.toContain("tabindex");
    }
    expect(
      decorations.filter((image) => image.includes("Objects1.png")),
    ).toHaveLength(2);
    expect(html).toContain('<h2 id="wedding-date-title">09 January 2027</h2>');
    expect(html).toContain(
      '<p class="closing-copy">See you at the Wedding!</p>',
    );
    expect(html).toContain("100% human made, no AI.");
  });

  it("maps the Groom role to Yohanes Armenian Putra with the Jo nickname", () => {
    const html = renderInvitation();

    expect(html).toContain(
      '<h3 id="groom-title">Yohanes Armenian Putra <span class="couple-nickname">(Jo)</span></h3>',
    );
    expect(html).toContain('<span class="couple-nickname">(Jo)</span>');
  });

  it("orders the Bride before the Groom and keeps both image roles matched", () => {
    const html = renderInvitation().replace(
      /(?:src|srcSet)="[^"]*"/g,
      decodeURIComponent,
    );

    expect(html.indexOf('id="bride-title"')).toBeLessThan(
      html.indexOf('id="groom-title"'),
    );
    expect(html.indexOf('class="couple-media-slot"')).toBeLessThan(
      html.indexOf(weddingMedia.bride),
    );
    expect(html.indexOf(weddingMedia.bride)).toBeLessThan(
      html.indexOf(weddingMedia.groom),
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
