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
    expect(html).toContain('aria-label="RSVP Anda"');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Konfirmasi Kehadiran");
    expect(html).not.toContain("Sesi mana yang akan Anda hadiri?");
    expect(html).not.toContain("Siapa yang akan hadir?");
    expect(html).not.toContain("Kebutuhan dan preferensi makanan");
    expect(html).not.toContain("guest-checkin-pass");
    expect(html).toContain("Dengan senang hati hadir");
    expect(html).toContain("Mohon maaf, tidak dapat hadir");
  });
  it("renders accepted confirmation and physical arrival instructions without editable inputs", () => {
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
      "Pendamping tambahan",
      "Anak tambahan",
      "Holy Matrimony",
      "Reception",
      "No seafood",
      "Jumlah tamu yang akan hadir: 4",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Robin Guest");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("Ubah RSVP");
    expect(html).toContain("Kehadiran Terkonfirmasi");
    expect(html).toContain(
      "Silakan tunjukkan undangan ini kepada penerima tamu saat tiba di lokasi acara.",
    );
    expect(html).not.toContain("QR Check-in");
    expect(html.includes(activePass.qrPayload)).toBe(false);
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
    expect(html).not.toContain("Pendamping tambahan");
    expect(html).not.toContain("Anak tambahan");
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
    expect(html).toContain("Tidak Hadir");
    expect(html).toContain("Ubah RSVP");
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
    expect(html).toContain("Muat Ulang RSVP");
  });
});
