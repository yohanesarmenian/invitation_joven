"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ClosedEnvelopeCover, OpenedCoverStage } from "./invitation-cover";
import {
  invitationMotion,
  invitationMotionStyle,
} from "../../src/presentation/invitation-motion";
import {
  INITIAL_INVITATION_STAGE,
  nextInvitationStage,
  type InvitationStage,
} from "./invitation-opening-state";

const MOTION_PREFERENCE_KEY = "jo-venta-motion";
const subscribeHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;
function readMotionPreference(): boolean | null {
  try {
    const value = window.localStorage.getItem(MOTION_PREFERENCE_KEY);
    return value === "full" ? true : value === "reduced" ? false : null;
  } catch {
    return null;
  }
}
function subscribeMotionPreference(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function InvitationOpeningFlow({ children }: { children: ReactNode }) {
  const interactive = useSyncExternalStore(
    subscribeHydration,
    hydratedSnapshot,
    serverSnapshot,
  );
  const [stage, setStage] = useState<InvitationStage>(INITIAL_INVITATION_STAGE);
  const openedButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const heroReadyRef = useRef(false);
  const preparingRef = useRef(false);
  const imageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [entering, setEntering] = useState(false);
  const [systemReduced, setSystemReduced] = useState(false);
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const savedMotion = useSyncExternalStore(
    subscribeMotionPreference,
    readMotionPreference,
    () => null,
  );
  const effectiveOverride = motionOverride ?? savedMotion;
  const reduced =
    effectiveOverride === null ? systemReduced : !effectiveOverride;
  const openingRef = useRef(false);
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enteringRef = useRef(false);

  const finishEntry = useCallback(() => {
    if (!enteringRef.current) return;
    enteringRef.current = false;
    if (entryTimer.current !== null) clearTimeout(entryTimer.current);
    entryTimer.current = null;
    setEntering(false);
    setStage("content");
  }, []);

  const finishOpening = useCallback(() => {
    if (!openingRef.current) return;
    openingRef.current = false;
    if (openingTimer.current !== null) clearTimeout(openingTimer.current);
    openingTimer.current = null;
    preparingRef.current = false;
    if (imageTimer.current !== null) clearTimeout(imageTimer.current);
    imageTimer.current = null;
    setPreparing(false);
    setOpening(false);
    setStage((current) =>
      current === "closed" ? nextInvitationStage(current) : current,
    );
  }, []);

  const beginOpening = useCallback(() => {
    if (!openingRef.current) return;
    preparingRef.current = false;
    if (imageTimer.current !== null) clearTimeout(imageTimer.current);
    imageTimer.current = null;
    setPreparing(false);
    setOpening(true);
    openingTimer.current = setTimeout(
      finishOpening,
      invitationMotion.fold +
        invitationMotion.stagger +
        invitationMotion.fallbackGrace,
    );
  }, [finishOpening]);

  const coverReady = useCallback(() => {
    heroReadyRef.current = true;
    if (preparingRef.current) beginOpening();
  }, [beginOpening]);

  const advance = useCallback(() => {
    if (openingRef.current || enteringRef.current) return;
    if (stage === "closed" && !reduced) {
      openingRef.current = true;
      if (heroReadyRef.current) beginOpening();
      else {
        preparingRef.current = true;
        setPreparing(true);
        // A slow or broken image must never trap guests behind the envelope.
        imageTimer.current = setTimeout(
          beginOpening,
          invitationMotion.imageWait,
        );
      }
      return;
    }
    if (stage === "opened" && !reduced) {
      enteringRef.current = true;
      setEntering(true);
      entryTimer.current = setTimeout(
        finishEntry,
        invitationMotion.entry + invitationMotion.fallbackGrace,
      );
      return;
    }
    setStage((current) => nextInvitationStage(current));
  }, [beginOpening, finishEntry, reduced, stage]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setSystemReduced(preference.matches);
      if (preference.matches && effectiveOverride !== true) {
        finishOpening();
        finishEntry();
      }
    };
    onChange();
    preference.addEventListener("change", onChange);
    return () => {
      preference.removeEventListener("change", onChange);
    };
  }, [finishOpening, finishEntry, effectiveOverride]);

  useEffect(() => {
    if (reduced) {
      finishOpening();
      finishEntry();
    }
  }, [reduced, finishOpening, finishEntry]);

  useEffect(
    () => () => {
      if (imageTimer.current !== null) clearTimeout(imageTimer.current);
      if (openingTimer.current !== null) clearTimeout(openingTimer.current);
      if (entryTimer.current !== null) clearTimeout(entryTimer.current);
    },
    [],
  );

  function toggleMotion() {
    setMotionOverride(reduced);
    try {
      window.localStorage.setItem(
        MOTION_PREFERENCE_KEY,
        reduced ? "full" : "reduced",
      );
    } catch {
      /* In-memory choice remains usable when storage is unavailable. */
    }
    if (!reduced) {
      finishOpening();
      finishEntry();
    }
  }

  useEffect(() => {
    if (stage === "opened") {
      openedButtonRef.current?.focus();
    } else if (stage === "content") {
      window.scrollTo(0, 0);
      contentRef.current?.focus({ preventScroll: true });
    }
  }, [stage]);

  useEffect(() => {
    if (
      stage !== "content" ||
      typeof window.IntersectionObserver !== "function"
    )
      return;
    const sections = Array.from(
      contentRef.current?.querySelectorAll("[data-invitation-reveal]") ?? [],
    );
    let observer: IntersectionObserver | undefined;
    try {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            // Base content stays visible; focusable forms/pass are not reveal targets.
            entry.target.classList.add("invitation-revealed");
            observer?.unobserve(entry.target);
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -24px 0px" },
      );
      sections.forEach((section) => {
        if (reduced) section.classList.add("invitation-revealed");
        else section.classList.add("invitation-reveal-ready");
        observer?.observe(section);
      });
    } catch {
      sections.forEach((section) =>
        section.classList.add("invitation-revealed"),
      );
    }
    return () => {
      observer?.disconnect();
      sections.forEach((section) =>
        section.classList.remove("invitation-reveal-ready"),
      );
    };
  }, [stage, reduced]);

  return (
    <div className="invitation-viewport">
      <div
        className="invitation-opening-flow"
        data-stage={stage}
        data-motion={reduced ? "reduced" : "full"}
        style={invitationMotionStyle}
      >
        <button
          type="button"
          className="invitation-motion-toggle"
          aria-label="Enable animations"
          aria-pressed={!reduced}
          disabled={!interactive}
          onClick={toggleMotion}
        >
          Animations: {reduced ? "Off" : "On"}
        </button>
        {stage !== "content" ? (
          <div
            className="invitation-cover-stack"
            data-exiting={entering || undefined}
          >
            <div
              className="invitation-cover-underlay"
              inert={stage === "closed"}
              aria-hidden={stage === "closed" || undefined}
            >
              <OpenedCoverStage
                onView={advance}
                buttonRef={openedButtonRef}
                onReady={coverReady}
                disabled={!interactive || entering}
              />
            </div>
            {stage === "closed" ? (
              <ClosedEnvelopeCover
                onOpen={advance}
                opening={opening}
                preparing={preparing}
                ready={interactive}
                onOpeningComplete={finishOpening}
              />
            ) : null}
          </div>
        ) : null}
        {stage === "content" || entering ? (
          <div
            ref={contentRef}
            tabIndex={-1}
            className="invitation-opening-content"
            data-entering={entering || undefined}
            onAnimationEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                event.animationName === "invitation-content-enter"
              )
                finishEntry();
            }}
          >
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
