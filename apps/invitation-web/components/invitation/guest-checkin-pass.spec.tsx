import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QRCodeSVG } from "qrcode.react";
import { GuestCheckinPass } from "./guest-checkin-pass";
import { activePass } from "./public-rsvp.fixtures";

vi.mock("qrcode.react", () => ({
  QRCodeSVG: vi.fn(() => createElement("svg")),
}));

beforeEach(() => vi.clearAllMocks());

describe("GuestCheckinPass", () => {
  it("passes the exact canonical credential to the encoder and the fallback", () => {
    const html = renderToStaticMarkup(
      createElement(GuestCheckinPass, { pass: activePass }),
    );
    const props = vi.mocked(QRCodeSVG).mock.calls[0]?.[0];
    // Boolean assertions keep even synthetic credential contents out of failures.
    expect(props?.value === activePass.qrPayload).toBe(true);
    expect(html.includes(activePass.qrPayload)).toBe(true);
    expect(html.split(activePass.qrPayload).length - 1).toBe(1);
    expect(props).toMatchObject({
      level: "M",
      boostLevel: false,
      marginSize: 4,
      size: 240,
    });
    // Next's image sizing marker is public rendering metadata, not pass data.
    const privacyMarkup = html.replace(/\sdata-nimg="(?:1|fill)"/g, "");
    expect(privacyMarkup).not.toMatch(
      /href=|type="hidden"|data-|issuedAt|tokenHash|credentialVersion|invitationId|rsvpId/,
    );
    expect(html).not.toContain(activePass.issuedAt);
  });

  it("conveys acceptance and the household pass without relying on its QR image", () => {
    const html = renderToStaticMarkup(
      createElement(GuestCheckinPass, { pass: activePass }),
    );
    const props = vi.mocked(QRCodeSVG).mock.calls[0]?.[0];
    expect(html).toContain("Your check-in pass");
    expect(html).toContain("Your acceptance is saved.");
    expect(html).toContain("Check-in code");
    expect(html).toContain("aria-labelledby=");
    expect(props?.role).toBe("img");
    expect(props?.["aria-label"]).toBe("Household check-in pass QR code");
  });

  it("renders nothing without an active pass", () => {
    expect(
      renderToStaticMarkup(createElement(GuestCheckinPass, { pass: null })),
    ).toBe("");
    expect(QRCodeSVG).not.toHaveBeenCalled();
  });
});
