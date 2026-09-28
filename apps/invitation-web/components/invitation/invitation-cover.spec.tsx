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
    expect(html).toContain("invitation-envelope-flap");
    expect(html).toContain("invitation-envelope-seal");
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

  it("renders the opened cover hero from the local 4B0 mock asset", () => {
    const html = renderToStaticMarkup(
      createElement(OpenedCoverStage, { onView: () => {} }),
    );

    expect(html).toContain("<img");
    expect(html).toContain('src="/assets/mock/hero.svg"');
    expect(html).toContain('data-nimg="fill"');
    expect(html).toContain('alt=""');
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
