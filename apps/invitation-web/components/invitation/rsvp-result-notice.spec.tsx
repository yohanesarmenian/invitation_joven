import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RsvpResultNotice } from "./rsvp-result-notice";
import { rsvpFailureNotice } from "../../src/rsvp/notice";

describe("RSVP result notice semantics", () => {
  it("provides an alert focus target and an accessible reload button", () => {
    const html = renderToStaticMarkup(
      createElement(RsvpResultNotice, {
        notice: rsvpFailureNotice({
          kind: "api",
          httpStatus: 409,
          code: "RSVP_VERSION_CONFLICT",
        }),
        id: "rsvp-error",
        pending: true,
        onReload: vi.fn(),
        onReview: vi.fn(),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('type="button"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("Loading RSVP");
  });
  it("offers a section correction without exposing raw domain codes", () => {
    const html = renderToStaticMarkup(
      createElement(RsvpResultNotice, {
        notice: rsvpFailureNotice({
          kind: "api",
          httpStatus: 422,
          code: "EVENT_NOT_SELECTED",
        }),
        id: "rsvp-error",
        pending: false,
        onReload: vi.fn(),
        onReview: vi.fn(),
      }),
    );
    expect(html).toContain("Review events");
    expect(html).not.toContain("EVENT_NOT_SELECTED");
    expect(html).not.toContain("Reload latest");
  });
});
