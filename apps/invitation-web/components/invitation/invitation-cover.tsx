import Image from "next/image";
import type { Ref } from "react";

// 4B0 development fixtures. These local mock assets stand in for the
// owner-approved photographs and are expected to be replaced in 4B1.
const MOCK_HERO = "/assets/mock/hero.svg";
const MOCK_HERO_SIZES = "(min-width: 388px) 340px, calc(100vw - 48px)";

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
          <span className="invitation-envelope-flap" />
          <span className="invitation-envelope-seal" />
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
        onClick={onView}
      >
        <span className="invitation-opened-media" aria-hidden="true">
          <Image
            src={MOCK_HERO}
            alt=""
            fill
            sizes={MOCK_HERO_SIZES}
            unoptimized
          />
        </span>
        <span className="invitation-opened-title">
          <span className="invitation-opened-kicker">The Wedding of</span>
          <span className="invitation-opened-names">Jo &amp; Venta</span>
        </span>
      </button>
    </div>
  );
}
