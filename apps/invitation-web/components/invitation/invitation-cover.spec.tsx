import { weddingMedia } from "../../src/presentation/wedding-media";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClosedEnvelopeCover, InvitationHero } from "./invitation-cover.js";

describe("invitation cover markup", () => {
  it("renders the closed envelope as a real accessible button", () => {
    const html = renderToStaticMarkup(
      createElement(ClosedEnvelopeCover, { onOpen: () => {} }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open invitation"');
    expect(html).toContain("invitation-envelope");
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain('data-opening="true"');
  });

  it("renders native paper folds and a champagne monogram without image artwork", () => {
    const html = renderToStaticMarkup(
      createElement(ClosedEnvelopeCover, { onOpen: () => {} }),
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/assets/");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("invitation-envelope-layer-front");
    expect(html).toContain("invitation-envelope-layer-right");
    expect(html).toContain("invitation-envelope-wax");
    expect(html).toContain("invitation-envelope-ampersand");
    expect(html).toContain(
      'Y<span class="invitation-envelope-ampersand">&amp;</span>A',
    );
  });

  it.each([
    { ready: false, message: "Loading invitation…" },
    { preparing: true, message: "Preparing your invitation…" },
    { opening: true, message: "Opening invitation…" },
  ])(
    "disables the envelope and politely reports $message",
    ({ message, ...props }) => {
      const html = renderToStaticMarkup(
        createElement(ClosedEnvelopeCover, { onOpen: () => {}, ...props }),
      );

      expect(html).toContain('disabled=""');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('role="status" aria-live="polite"');
      expect(html).toContain(message);
      expect(html.includes('data-opening="true"')).toBe("opening" in props);
    },
  );

  it("renders the hero as static content with a semantic wedding title", () => {
    const html = renderToStaticMarkup(createElement(InvitationHero));

    expect(html).toContain('<header class="invitation-hero"');
    expect(html).toContain('aria-labelledby="invitation-hero-title"');
    expect(html).toContain('<h1 id="invitation-hero-title"');
    expect(html).toContain("The Wedding of");
    expect(html).toContain("Jo <span><i>&amp;</i> Venta</span>");
    expect(html).toContain(
      'class="invitation-hero-monogram" aria-hidden="true">Y<span>&amp;</span>A',
    );
    expect(html).toContain("invitation-hero-media");
    expect(html).not.toMatch(/<(?:button|form|input|select|textarea|a)\b/);
    expect(html).not.toMatch(/(?:Open|View) invitation/i);
  });

  it("renders the approved local hero through responsive image optimization", () => {
    const html = renderToStaticMarkup(createElement(InvitationHero));

    expect(html).toContain("<img");
    const image = (html.match(/<img[^>]*>/g) ?? [])[0]!.replace(
      /(?:src|srcSet)="[^"]*"/g,
      decodeURIComponent,
    );
    expect(image).toContain(weddingMedia.hero);
    expect(image).toContain("/_next/image?");
    expect(image).toContain('srcSet="');
    expect(image).toContain('sizes="');
    expect(html).not.toContain("/assets/mock/hero.svg");
    expect(html).toContain('data-nimg="fill"');
    expect(html).toContain('alt=""');
    expect(image).toContain('sizes="100vw"');
    expect(image).toContain('loading="eager"');
    expect(image).toContain('fetchPriority="high"');
  });

  it("keeps the semantic title visible separately from decorative photography", () => {
    const html = renderToStaticMarkup(createElement(InvitationHero));

    expect(html.match(/The Wedding of/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    const title = html.slice(
      html.indexOf('<h1 id="invitation-hero-title"'),
      html.indexOf("</h1>"),
    );
    expect(title).not.toContain("aria-hidden");
    expect(title).not.toContain("display:none");
    expect(title).not.toContain("visibility:hidden");
  });

  it("keeps hero media local and decorative", () => {
    const html = renderToStaticMarkup(createElement(InvitationHero));

    expect(html).not.toContain("http");
    expect(html).not.toContain("//");
    expect(html).toContain('alt=""');
    expect(html).not.toContain('alt="MOCK HERO"');
    expect(html).toContain('loading="eager"');
  });

  it("omits the pending image for the parent deadline fallback", () => {
    const html = renderToStaticMarkup(
      createElement(InvitationHero, { fallback: true }),
    );

    expect(html).toContain('data-fallback="true"');
    expect(html).toContain("invitation-hero-paper");
    expect(html).toContain(
      'class="invitation-hero-paper-monogram">Y<i>&amp;</i>A',
    );
    expect(html).toContain("One day. Our forever.");
    expect(html).toContain('<h1 id="invitation-hero-title"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain(weddingMedia.heroFallback);
    expect(html).not.toContain("<button");
  });

  it("shows no guest name on the closed cover", () => {
    const html = renderToStaticMarkup(
      createElement(ClosedEnvelopeCover, { onOpen: () => {} }),
    );

    expect(html).not.toContain("Dear");
  });
});
