"use client";

import { useEffect, useRef } from "react";

export function InvitationResultsHeading() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.location.hash === "#invitation-results-heading")
      heading.current?.focus();
  }, []);
  return (
    <h2 ref={heading} id="invitation-results-heading" tabIndex={-1}>
      Invitations
    </h2>
  );
}
