import type { Ref } from "react";

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
        <span className="invitation-opened-media" aria-hidden="true" />
        <span className="invitation-opened-title">
          <span className="invitation-opened-kicker">The Wedding of</span>
          <span className="invitation-opened-names">Jo &amp; Venta</span>
        </span>
      </button>
    </div>
  );
}
