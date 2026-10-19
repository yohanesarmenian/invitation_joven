import { useId } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PublicRsvpReadResponse } from "../../../../packages/api-client/src/index";
import { FigmaConfirmationArt } from "./figma-confirmation-art";

export function GuestCheckinPass({
  pass,
}: {
  pass: PublicRsvpReadResponse["checkinPass"];
}) {
  const id = useId();
  if (!pass || pass.status !== "ACTIVE") return null;

  return (
    <section className="guest-checkin-pass" aria-labelledby={`${id}-title`}>
      <FigmaConfirmationArt />
      <div className="figma-pass-content">
        <h3 id={`${id}-title`} aria-label="Your check-in pass">
          Thank You for Confirming!
        </h3>
        <p>
          <span className="visually-hidden">Your acceptance is saved. </span>We
          have received your RSVP and cannot wait to celebrate our special day
          with you.
        </p>
        <p className="figma-pass-instruction">
          Please save or screenshot this QR code/code. You may present it upon
          arrival at the venue.
        </p>
        <QRCodeSVG
          value={pass.qrPayload}
          size={240}
          level="M"
          boostLevel={false}
          marginSize={4}
          bgColor="#ffffff"
          fgColor="#000000"
          role="img"
          aria-label="Household check-in pass QR code"
          aria-describedby={`${id}-code-label`}
        />
        <p id={`${id}-code-label`} className="checkin-code-label">
          Check-in code
        </p>
        <code className="checkin-code" aria-labelledby={`${id}-code-label`}>
          {pass.qrPayload}
        </code>
        <button
          className="figma-pass-back"
          type="button"
          onClick={() => {
            document
              .querySelector<HTMLElement>(".invitation-opening-content")
              ?.focus();
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "instant"
                : "smooth",
            });
          }}
        >
          Back to Invitation
        </button>
      </div>
    </section>
  );
}
