import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublicRsvpForm, type PublicRsvpFormProps } from "./public-rsvp-form";
import { acceptedRsvp, rsvpInvitation } from "./public-rsvp.fixtures";

function render(props: Partial<PublicRsvpFormProps> = {}) {
  return renderToStaticMarkup(
    createElement(PublicRsvpForm, {
      invitation: rsvpInvitation,
      initialResult: {
        status: "success",
        data: { rsvp: null, checkinPass: null },
      },
      submitAction: vi.fn(),
      ...props,
    }),
  );
}

describe("PublicRsvpForm rendering", () => {
  it("renders an unanswered semantic form with native mutually exclusive radios", () => {
    const html = render();
    expect(html).toContain("<form");
    expect(html).toContain('aria-label="Your RSVP"');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Joyfully Accept");
    expect(html).toContain("Regretfully Decline");
  });
  it("prepopulates accepted fields and labels, without pass UI or guest message", () => {
    const html = render({
      initialResult: {
        status: "success",
        data: {
          rsvp: acceptedRsvp,
          checkinPass: { status: "ACTIVE", issuedAt: "2026-09-29T00:00:00Z" },
        },
      },
    });
    for (const text of [
      "Alex Guest",
      "Robin Guest",
      "Bring a plus one",
      "Additional children",
      "Holy Matrimony",
      "Reception",
      "No seafood",
      "Total attending: 4",
    ])
      expect(html).toContain(text);
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('max="2"');
    expect(html).toContain('max="4"');
    expect(html).not.toMatch(
      /guestNote|qrPayload|checkinPass|issuedAt|PENDING/,
    );
  });
  it("omits companions and children when the invitation does not permit them", () => {
    const html = render({
      invitation: {
        ...rsvpInvitation,
        rules: { allowPlusOne: false, maxAdditionalChildren: 0 },
      },
      initialResult: {
        status: "success",
        data: { rsvp: acceptedRsvp, checkinPass: null },
      },
    });
    expect(html).not.toContain("Bring a plus one");
    expect(html).not.toContain("Additional children");
  });
  it("preselects decline while hiding all accepted-only controls", () => {
    const html = render({
      initialResult: {
        status: "success",
        data: {
          rsvp: { ...acceptedRsvp, status: "DECLINED" },
          checkinPass: null,
        },
      },
    });
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("No seafood");
    expect(html).not.toContain('type="checkbox"');
  });
  it("does not expose a submit form after a failed initial read", () => {
    const html = render({
      initialResult: {
        status: "error",
        error: {
          kind: "api",
          httpStatus: 404,
          code: "INVITATION_NOT_AVAILABLE",
        },
      },
    });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("INVITATION_NOT_AVAILABLE");
  });
});
