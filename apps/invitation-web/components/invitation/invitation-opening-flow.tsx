"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ClosedEnvelopeCover, InvitationHero } from "./invitation-cover";
import { InvitationContentVisible } from "./invitation-opening-context";
import {
  invitationMotion,
  invitationMotionStyle,
} from "../../src/presentation/invitation-motion";
import {
  INITIAL_INVITATION_STAGE,
  nextInvitationStage,
  type InvitationStage,
} from "./invitation-opening-state";

const subscribeHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export function InvitationOpeningFlow({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    hydratedSnapshot,
    serverSnapshot,
  );
  const [stage, setStage] = useState<InvitationStage>(INITIAL_INVITATION_STAGE);
  const stageRef = useRef<InvitationStage>(INITIAL_INVITATION_STAGE);
  const contentRef = useRef<HTMLDivElement>(null);
  const [prepared, setPrepared] = useState(false);
  const [heroFallback, setHeroFallback] = useState(false);
  const preparedRef = useRef(false);
  const heroReadyRef = useRef(false);
  const fontsReadyRef = useRef(false);
  const mountedRef = useRef(false);
  const preparationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reduced, setReduced] = useState(false);

  const finishPreparation = useCallback(() => {
    if (!mountedRef.current || preparedRef.current) return;
    preparedRef.current = true;
    if (preparationTimer.current !== null)
      clearTimeout(preparationTimer.current);
    preparationTimer.current = null;
    setPrepared(true);
  }, []);

  const coverReady = useCallback(() => {
    heroReadyRef.current = true;
    if (fontsReadyRef.current) finishPreparation();
  }, [finishPreparation]);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    // Only the initial photo and fonts gate opening. Lower images remain lazy.
    preparationTimer.current = setTimeout(() => {
      if (!heroReadyRef.current) setHeroFallback(true);
      finishPreparation();
    }, invitationMotion.imageWait);
    const fontsSettled = () => {
      if (!active) return;
      fontsReadyRef.current = true;
      if (heroReadyRef.current) finishPreparation();
    };
    void Promise.resolve(document.fonts?.ready).then(
      fontsSettled,
      fontsSettled,
    );
    return () => {
      active = false;
      mountedRef.current = false;
      if (preparationTimer.current !== null)
        clearTimeout(preparationTimer.current);
      preparationTimer.current = null;
      if (openingTimer.current !== null) clearTimeout(openingTimer.current);
      openingTimer.current = null;
    };
  }, [finishPreparation]);

  const finishOpening = useCallback(() => {
    if (!mountedRef.current || stageRef.current !== "opening") return;
    if (openingTimer.current !== null) clearTimeout(openingTimer.current);
    openingTimer.current = null;
    stageRef.current = nextInvitationStage(stageRef.current);
    setStage(stageRef.current);
  }, []);

  const advance = useCallback(() => {
    if (!hydrated || !preparedRef.current || stageRef.current !== "closed")
      return;
    // A synchronous guard also rejects activations in the same React batch.
    stageRef.current = reduced
      ? "content"
      : nextInvitationStage(stageRef.current);
    setStage(stageRef.current);
    if (!reduced) {
      openingTimer.current = setTimeout(
        finishOpening,
        invitationMotion.fold +
          invitationMotion.stagger +
          invitationMotion.fallbackGrace,
      );
    }
  }, [finishOpening, hydrated, reduced]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setReduced(preference.matches);
      if (preference.matches) finishOpening();
    };
    onChange();
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, [finishOpening]);

  useEffect(() => {
    if (reduced) finishOpening();
  }, [reduced, finishOpening]);

  useEffect(() => {
    if (stage !== "content") return;
    window.scrollTo(0, 0);
    contentRef.current?.focus({ preventScroll: true });
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

  const concealed = stage !== "content";
  return (
    <div className="invitation-viewport">
      <div
        className="invitation-opening-flow"
        data-stage={stage}
        data-motion={reduced ? "reduced" : "full"}
        style={invitationMotionStyle}
      >
        <div
          ref={contentRef}
          tabIndex={-1}
          className="invitation-opening-content"
          inert={concealed}
          aria-hidden={concealed || undefined}
        >
          <InvitationHero onReady={coverReady} fallback={heroFallback} />
          <InvitationContentVisible value={!concealed}>
            {children}
          </InvitationContentVisible>
        </div>
        {concealed && (
          <div className="invitation-cover-stack">
            <ClosedEnvelopeCover
              onOpen={advance}
              opening={stage === "opening"}
              preparing={!prepared}
              ready={hydrated && prepared}
              onOpeningComplete={finishOpening}
            />
          </div>
        )}
      </div>
    </div>
  );
}
