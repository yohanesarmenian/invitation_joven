import { useId } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PublicRsvpReadResponse } from "../../../../packages/api-client/src/index";
import { FigmaConfirmationArt } from "./figma-confirmation-art";
import { CHECKIN_PASS_HEADING_ID } from "./invitation-opening-context";

export function GuestCheckinPass({
  pass,
}: {
  pass: PublicRsvpReadResponse["checkinPass"];
}) {
  const id = useId();
  if (!pass || pass.status !== "ACTIVE") return null;

  return (
    <section
      className="guest-checkin-pass"
      aria-labelledby={CHECKIN_PASS_HEADING_ID}
    >
      <FigmaConfirmationArt />
      <div className="figma-pass-content">
        <h3
          id={CHECKIN_PASS_HEADING_ID}
          tabIndex={-1}
          className="invitation-rsvp-jump-target"
        >
          QR Check-in Anda
        </h3>
        <p>
          Jawaban RSVP Anda sudah tersimpan. Kami menantikan kehadiran Anda.
        </p>
        <p className="figma-pass-instruction">
          Tunjukkan QR ini kepada petugas penerima tamu saat tiba. Jika QR tidak
          terbaca, petugas dapat membantu Anda.
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
          aria-label="Kode QR untuk check-in rombongan Anda"
          aria-describedby={`${id}-code-label`}
        />
        <p id={`${id}-code-label`} className="checkin-code-label">
          Kode check-in
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
          Kembali ke Undangan
        </button>
      </div>
    </section>
  );
}
