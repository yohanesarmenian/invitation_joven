"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const targets = new Map([
  ["#invitation-overview", "invitation-overview"],
  ["#guest-management", "guest-management"],
  ["#eligible-events-title", "eligible-events-title"],
  ["#invitation-activity", "invitation-activity"],
  ["#sharing", "invitation-sharing-heading"],
  ["#invitation-advanced", "invitation-advanced"],
]);

export function InvitationDetailFragment({
  invitationId,
}: {
  invitationId: string;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== `/invitations/${invitationId}`) return;

    // The route shell can commit before the streamed detail contains the target.
    const fragment = window.location.hash;
    const id = targets.get(fragment);
    if (!id) return;

    const frame = requestAnimationFrame(() => {
      if (
        window.location.pathname !== pathname ||
        window.location.hash !== fragment
      )
        return;
      const target = document.getElementById(id);
      if (!target) return;
      const active = document.activeElement;
      if (
        active === target ||
        (active?.closest(".invitation-detail") &&
          active.matches("input, select, textarea, [contenteditable]"))
      )
        return;

      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [invitationId, pathname]);

  return null;
}
