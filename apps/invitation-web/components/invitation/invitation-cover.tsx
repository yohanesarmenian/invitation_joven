"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { weddingMedia } from "../../src/presentation/wedding-media";

export function ClosedEnvelopeCover({
  onOpen,
  opening = false,
  preparing = false,
  ready = true,
  onOpeningComplete,
}: {
  onOpen: () => void;
  opening?: boolean;
  preparing?: boolean;
  ready?: boolean;
  onOpeningComplete?: () => void;
}) {
  const busy = !ready || opening || preparing;
  const status = !ready
    ? "Loading invitation…"
    : preparing
      ? "Preparing your invitation…"
      : opening
        ? "Opening invitation…"
        : "";

  return (
    <div
      className="invitation-closed-stage"
      data-opening={opening || undefined}
    >
      <button
        type="button"
        className="invitation-envelope-button"
        aria-label="Open invitation"
        onClick={onOpen}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        <span className="invitation-envelope" aria-hidden="true">
          <span
            className="invitation-envelope-layer invitation-envelope-layer-right"
            onTransitionEnd={(event) => {
              if (
                opening &&
                event.target === event.currentTarget &&
                event.propertyName === "transform"
              )
                onOpeningComplete?.();
            }}
          />
          <span className="invitation-envelope-layer invitation-envelope-layer-front">
            <span className="invitation-envelope-wax">
              <span>
                Y<span className="invitation-envelope-ampersand">&amp;</span>A
              </span>
            </span>
          </span>
        </span>
        <span className="invitation-envelope-heading" aria-hidden="true">
          A celebration of love
          <span>Jo &amp; Venta</span>
        </span>
        <span className="invitation-envelope-hint" aria-hidden="true">
          Open invitation <span>↗</span>
        </span>
        <span className="invitation-envelope-foot" aria-hidden="true">
          Together with our families
        </span>
      </button>
      <p
        className="invitation-envelope-status"
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
    </div>
  );
}

export function InvitationHero({
  onReady,
  fallback = false,
}: {
  onReady?: () => void;
  fallback?: boolean;
}) {
  const [heroFailed, setHeroFailed] = useState(false);
  const ready = useRef(false);
  const showFallback = heroFailed || fallback;

  function finishReady() {
    if (ready.current) return;
    ready.current = true;
    onReady?.();
  }

  return (
    <header
      className="invitation-hero"
      data-fallback={showFallback || undefined}
      aria-labelledby="invitation-hero-title"
    >
      <div className="invitation-hero-copy">
        <span className="invitation-hero-monogram" aria-hidden="true">
          Y<span>&amp;</span>A
        </span>
        <div className="invitation-hero-introduction">
          <p className="invitation-hero-kicker">The Wedding of</p>
          <h1 id="invitation-hero-title" className="invitation-hero-title">
            Jo{" "}
            <span>
              <i>&amp;</i> Venta
            </span>
          </h1>
          <p className="invitation-hero-message">
            Some moments are meant
            <br />
            to be shared with you.
          </p>
        </div>
        <p className="invitation-hero-foot">Together with our families</p>
      </div>
      <div className="invitation-hero-media" aria-hidden="true">
        {showFallback ? (
          <div className="invitation-hero-paper">
            <span className="invitation-hero-paper-monogram">
              Y<i>&amp;</i>A
            </span>
            <span>One day. Our forever.</span>
          </div>
        ) : (
          <Image
            src={weddingMedia.hero}
            alt=""
            fill
            sizes="100vw"
            loading="eager"
            fetchPriority="high"
            onLoad={async (event) => {
              const image = event.currentTarget;
              try {
                await image.decode();
              } catch {
                setHeroFailed(true);
              }
              finishReady();
            }}
            onError={() => {
              setHeroFailed(true);
              finishReady();
            }}
          />
        )}
      </div>
    </header>
  );
}
