import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvitationOpeningFlow } from "./invitation-opening-flow";
import { InvitationGallery } from "./gallery";

describe("server-rendered opening preparation", () => {
  it("pre-renders authorized children behind an inert, hidden content boundary", () => {
    const html = renderToStaticMarkup(
      <InvitationOpeningFlow>
        <form aria-label="Authorized fixture form">
          <button type="submit">Submit fixture</button>
        </form>
      </InvitationOpeningFlow>,
    );
    expect(html).toContain('data-stage="closed"');
    expect(html).toContain(
      'class="invitation-opening-content" inert="" aria-hidden="true"',
    );
    expect(html).toContain('aria-label="Authorized fixture form"');
    expect(html).toContain("Submit fixture");
    expect(html).toContain("invitation-hero");
    expect(html).not.toContain("View invitation");
  });

  it("keeps opening disabled before hydration and critical-asset readiness", () => {
    const html = renderToStaticMarkup(
      <InvitationOpeningFlow>
        <p>Authorized content</p>
      </InvitationOpeningFlow>,
    );
    const button = html.match(
      /<button[^>]*aria-label="Open invitation"[^>]*>/,
    )?.[0];
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-busy="true"');
  });

  it("reserves gallery frames while deferring their image sources until opening", () => {
    const html = renderToStaticMarkup(
      <InvitationOpeningFlow>
        <InvitationGallery />
      </InvitationOpeningFlow>,
    );
    expect(html.match(/class="gallery-frame /g)).toHaveLength(4);
    expect(html).not.toContain("pic-02-");
    expect(html).not.toContain("pic-03-");
    expect(html).not.toContain("pic-01-");
  });
});
