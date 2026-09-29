import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClosedEnvelopeCover, OpenedCoverStage } from "./invitation-cover.js";

describe("invitation cover markup", () => {
  it("renders the closed envelope as a real accessible button", () => {
    const html = renderToStaticMarkup(
      createElement(ClosedEnvelopeCover, { onOpen: () => {} }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Open invitation"');
    expect(html).toContain("invitation-envelope");
    expect(html).not.toContain('class="invitation-envelope-flap"');
    expect(html).not.toContain('class="invitation-envelope-seal"');
  });

  it("renders both approved envelope layers in order as decorative responsive images", () => {
    const html = renderToStaticMarkup(
      createElement(ClosedEnvelopeCover, { onOpen: () => {} }),
    );
    const images = html.match(/<img[^>]*>/g) ?? [];
    const assets = ["envelope-base.png", "envelope-flap-seal.png"];

    expect(images).toHaveLength(2);
    expect(html).toContain('aria-hidden="true"');
    assets.forEach((asset, index) => {
      const image = images[index]!.replace(
        /(?:src|srcSet)="[^"]*"/g,
        decodeURIComponent,
      );
      expect(image).toContain(`/assets/envelope/${asset}`);
      expect(image).toContain('alt=""');
      expect(image).toContain('data-nimg="fill"');
      expect(image).toContain('srcSet="');
      expect(image).toContain('sizes="');
      expect(image).not.toContain("http");
    });
  });

  it("renders the opened cover as a real accessible button with the reference title", () => {
    const html = renderToStaticMarkup(
      createElement(OpenedCoverStage, { onView: () => {} }),
    );

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="View invitation"');
    expect(html).toContain("The Wedding of");
    expect(html).toContain("Jo &amp; Venta");
    expect(html).toContain("invitation-opened-kicker");
    expect(html).toContain("invitation-opened-names");
    expect(html).toContain("invitation-opened-media");
  });

  it("renders the approved local hero through responsive image optimization", () => {
    const html = renderToStaticMarkup(
      createElement(OpenedCoverStage, { onView: () => {} }),
    );

    expect(html).toContain("<img");
    const image = (html.match(/<img[^>]*>/g) ?? [])[0]!.replace(
      /(?:src|srcSet)="[^"]*"/g,
      decodeURIComponent,
    );
    expect(image).toContain("/assets/hero/opened-hero.png");
    expect(image).toContain("/_next/image?");
    expect(image).toContain('srcSet="');
    expect(image).toContain('sizes="');
    expect(html).not.toContain("/assets/mock/hero.svg");
    expect(html).toContain('data-nimg="fill"');
    expect(html).toContain('alt=""');
  });

  it("describes the existing button with a visually hidden semantic title", () => {
    const html = renderToStaticMarkup(
      createElement(OpenedCoverStage, { onView: () => {} }),
    );

    expect(html).toContain('aria-describedby="invitation-opened-title"');
    expect(html).toContain(
      '<span id="invitation-opened-title" class="visually-hidden">',
    );
    expect(html).not.toContain('class="invitation-opened-title"');
    expect(html.match(/The Wedding of/g)).toHaveLength(1);
    expect(html.match(/Jo &amp; Venta/g)).toHaveLength(1);
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(?:form|input|select|textarea|a)\b/);
    const title = html.slice(
      html.indexOf('<span id="invitation-opened-title"'),
    );
    expect(title).not.toContain("aria-hidden");
    expect(title).not.toContain("display:none");
    expect(title).not.toContain("visibility:hidden");
  });

  it("keeps opened cover media local and decorative", () => {
    const html = renderToStaticMarkup(
      createElement(OpenedCoverStage, { onView: () => {} }),
    );

    expect(html).not.toContain("http");
    expect(html).not.toContain("//");
    expect(html).toContain('alt=""');
    expect(html).not.toContain('alt="MOCK HERO"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('loading="eager"');
  });

  it("shows no guest name on the closed cover", () => {
    const html = renderToStaticMarkup(
      createElement(ClosedEnvelopeCover, { onOpen: () => {} }),
    );

    expect(html).not.toContain("Dear");
  });
});
