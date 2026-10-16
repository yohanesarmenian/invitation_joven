"use client";

import Image from "next/image";
import { useState, type Ref } from "react";
import { weddingMedia } from "../../src/presentation/wedding-media";
import { figmaAssets } from "../../src/presentation/figma-assets";

const OPENED_HERO_SIZES = "100vw";

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
        disabled={!ready || opening || preparing}
        aria-busy={!ready || opening || preparing || undefined}
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
              <Image
                src={figmaAssets["7_2_Cover2A1"]}
                alt=""
                fill
                sizes="410px"
                loading="eager"
              />
            </span>
          </span>
        </span>
        <span className="invitation-envelope-hint" aria-hidden="true">
          {!ready
            ? "Loading invitation…"
            : preparing
              ? "Preparing your invitation…"
              : "Tap to open"}
        </span>
      </button>
    </div>
  );
}

export function OpenedCoverStage({
  onView,
  buttonRef,
  onReady,
  disabled = false,
}: {
  onView: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  onReady?: () => void;
  disabled?: boolean;
}) {
  const [heroFailed, setHeroFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  return (
    <div className="invitation-opened-stage">
      <button
        ref={buttonRef}
        type="button"
        className={`invitation-opened-cover${heroFailed ? " invitation-opened-cover-fallback" : ""}`}
        aria-label="View invitation"
        aria-describedby="invitation-opened-title"
        onClick={onView}
        disabled={disabled}
      >
        <span className="invitation-opened-media" aria-hidden="true">
          <Image
            src={heroFailed ? weddingMedia.heroFallback : weddingMedia.hero}
            alt=""
            fill
            sizes={
              heroFailed ? "(min-width: 332px) 332px, 100vw" : OPENED_HERO_SIZES
            }
            loading="eager"
            onLoad={onReady}
            onError={() => {
              if (heroFailed) {
                setFallbackFailed(true);
                onReady?.();
              } else setHeroFailed(true);
            }}
          />
        </span>
        <span
          id="invitation-opened-title"
          className={
            heroFailed && !fallbackFailed
              ? "visually-hidden"
              : "invitation-opened-title"
          }
        >
          <span className="invitation-opened-kicker">The Wedding of</span>{" "}
          <span className="invitation-opened-names">Jo &amp; Venta</span>
        </span>
        <span className="invitation-opened-action" aria-hidden="true">
          Open Invitation <span>↓</span>
        </span>
      </button>
    </div>
  );
}
