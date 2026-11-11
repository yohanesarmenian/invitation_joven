import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PublicRsvpForm, type PublicRsvpFormProps } from "./public-rsvp-form";
import {
  acceptedRsvp,
  activePass,
  rsvpInvitation,
} from "./public-rsvp.fixtures";

function render(props: Partial<PublicRsvpFormProps> = {}) {
  return renderToStaticMarkup(
    createElement(PublicRsvpForm, {
      invitation: rsvpInvitation,
      initialResult: {
        status: "success",
        data: {
          canEdit: true,
          editBlockedReason: null,
          rsvp: null,
          checkinPass: null,
        },
      },
      submitAction: vi.fn(),
      reloadAction: vi.fn(),
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
    expect(html).toContain("<textarea");
    expect(html).toContain("Attendance Confirmation");
    expect(html).toContain("Events Attending");
    expect(html).toContain("Bring someone special?");
    expect(html).toContain("Dietary Restrictions");
    expect(html).not.toContain("guest-checkin-pass");
    expect(html).toContain("Joyfully Accept");
    expect(html).toContain("Regretfully Decline");
  });
  it("renders accepted confirmation and canonical pass without editable inputs", () => {
    const html = render({
      initialResult: {
        status: "success",
        data: {
          canEdit: true,
          editBlockedReason: null,
          rsvp: acceptedRsvp,
          checkinPass: activePass,
        },
      },
    });
    for (const text of [
      "Alex Guest",
      "Plus-one",
      "Additional children",
      "Holy Matrimony",
      "Reception",
      "No seafood",
      "Expected guests: 4",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Robin Guest");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Edit RSVP");
    expect(html).toContain("Attendance Confirmed");
    expect(html).toContain("Your check-in pass");
    expect(html.includes(activePass.qrPayload)).toBe(true);
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
        data: {
          canEdit: true,
          editBlockedReason: null,
          rsvp: null,
          checkinPass: null,
        },
      },
    });
    expect(html).not.toContain("Plus-one");
    expect(html).not.toContain("Additional children");
  });
  it("renders saved decline without editable controls or an active pass", () => {
    const html = render({
      initialResult: {
        status: "success",
        data: {
          canEdit: true,
          editBlockedReason: null,
          rsvp: { ...acceptedRsvp, status: "DECLINED" },
          checkinPass: null,
        },
      },
    });
    expect(html).toContain("Unable to Attend");
    expect(html).toContain("Edit RSVP");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("No seafood");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("guest-checkin-pass");
    expect(html.includes(activePass.qrPayload)).toBe(false);
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
    expect(html).not.toContain("guest-checkin-pass");
    expect(html).not.toContain("INVITATION_NOT_AVAILABLE");
    expect(html).toContain("Reload latest RSVP");
  });
});
