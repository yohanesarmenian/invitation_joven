import Image from "next/image";
import type { Ref } from "react";

// Owner-approved flattened fallback: keep the complete artwork and its baked
// title intact until a clean owner photograph is available.
const OPENED_HERO = "/assets/hero/opened-hero.png";
const OPENED_HERO_SIZES = "(min-width: 332px) 332px, 100vw";

const ENVELOPE_SIZES = "(min-width: 480px) 480px, 100vw";

export function ClosedEnvelopeCover({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="invitation-closed-stage">
      <button
        type="button"
        className="invitation-envelope-button"
        aria-label="Open invitation"
        onClick={onOpen}
      >
        <span className="invitation-envelope" aria-hidden="true">
          <Image
            src="/assets/envelope/envelope-base.png"
            alt=""
            fill
            sizes={ENVELOPE_SIZES}
            loading="eager"
            className="invitation-envelope-layer"
          />
          <Image
            src="/assets/envelope/envelope-flap-seal.png"
            alt=""
            fill
            sizes={ENVELOPE_SIZES}
            loading="eager"
            className="invitation-envelope-layer invitation-envelope-layer-front"
          />
        </span>
      </button>
    </div>
  );
}

export function OpenedCoverStage({
  onView,
  buttonRef,
}: {
  onView: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <div className="invitation-opened-stage">
      <button
        ref={buttonRef}
        type="button"
        className="invitation-opened-cover"
        aria-label="View invitation"
        aria-describedby="invitation-opened-title"
        onClick={onView}
      >
        <span className="invitation-opened-media" aria-hidden="true">
          <Image src={OPENED_HERO} alt="" fill sizes={OPENED_HERO_SIZES} />
        </span>
        {/* A future clean photo can restore the invitation-opened-title class.
            The flattened fallback already supplies the visible typography. */}
        <span id="invitation-opened-title" className="visually-hidden">
          <span className="invitation-opened-kicker">The Wedding of</span>{" "}
          <span className="invitation-opened-names">Jo &amp; Venta</span>
        </span>
      </button>
    </div>
  );
}
