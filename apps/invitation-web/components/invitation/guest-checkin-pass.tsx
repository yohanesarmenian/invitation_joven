import { useId } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PublicRsvpReadResponse } from "../../../../packages/api-client/src/index";

export function GuestCheckinPass({
  pass,
}: {
  pass: PublicRsvpReadResponse["checkinPass"];
}) {
  const id = useId();
  if (!pass || pass.status !== "ACTIVE") return null;

  return (
    <section className="guest-checkin-pass" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>Your check-in pass</h3>
      <p>Your acceptance is saved. Keep this pass to show at event check-in.</p>
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
    </section>
  );
}
