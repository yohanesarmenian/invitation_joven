"use client";

import { useEffect, useState, type MouseEvent, type RefObject } from "react";
import {
  CHECKIN_PASS_HEADING_ID,
  RSVP_RESPONSE_HEADING_ID,
  type RsvpHeroAction,
} from "./invitation-opening-context";

const rsvpActions = {
  rsvp: { label: "View RSVP", target: "rsvp-title" },
  confirm: { label: "Confirm Attendance", target: "rsvp-title" },
  response: { label: "View RSVP Response", target: RSVP_RESPONSE_HEADING_ID },
  qr: { label: "View Check-in QR", target: CHECKIN_PASS_HEADING_ID },
} satisfies Record<RsvpHeroAction, { label: string; target: string }>;

export function InvitationRsvpAction({
  action,
  className,
}: {
  action: RsvpHeroAction;
  className: string;
}) {
  const { label, target } = rsvpActions[action];

  function navigateToRsvp(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;

    const heading =
      document.getElementById(target) ??
      document.getElementById(rsvpActions.rsvp.target);
    if (!heading || heading.closest("[inert]")) return;

    event.preventDefault();
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: "instant" });
  }

  return (
    <a className={className} href={`#${target}`} onClick={navigateToRsvp}>
      {label}
    </a>
  );
}

export function InvitationStickyRsvpAction({
  action,
  content,
}: {
  action: RsvpHeroAction;
  content: RefObject<HTMLDivElement | null>;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = content.current?.querySelector(".invitation-hero");
    const interactiveSections = content.current?.querySelectorAll(
      ".rsvp-information-section, .guest-message-section",
    );
    if (!hero || !interactiveSections || !window.IntersectionObserver) return;

    const viewport = window.visualViewport;
    let pastHero = false;
    const visibleSections = new Set<Element>();

    function updateVisibility() {
      const viewportObstructed =
        viewport &&
        (viewport.scale > 1 ||
          viewport.height < document.documentElement.clientHeight - 1);
      setVisible(pastHero && visibleSections.size === 0 && !viewportObstructed);
    }

    let observer: IntersectionObserver | undefined;
    let observing = false;
    try {
      observer = new IntersectionObserver((entries) => {
        if (!observing) return;
        for (const entry of entries) {
          if (entry.target === hero) {
            pastHero =
              !entry.isIntersecting &&
              entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0);
          } else if (entry.isIntersecting) {
            visibleSections.add(entry.target);
          } else {
            visibleSections.delete(entry.target);
          }
        }
        updateVisibility();
      });
      observer.observe(hero);
      for (const section of interactiveSections) observer.observe(section);
    } catch {
      observer?.disconnect();
      return;
    }

    observing = true;
    viewport?.addEventListener("resize", updateVisibility);

    return () => {
      observing = false;
      observer.disconnect();
      viewport?.removeEventListener("resize", updateVisibility);
    };
  }, [content]);

  return (
    <div className="invitation-sticky-rsvp" data-visible={visible || undefined}>
      <InvitationRsvpAction
        action={action}
        className="invitation-sticky-rsvp-link"
      />
    </div>
  );
}
