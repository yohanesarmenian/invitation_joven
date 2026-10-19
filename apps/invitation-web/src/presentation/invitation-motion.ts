import type { CSSProperties } from "react";

// CSS and fallback deadlines share these values. End events normally finish stages.
export const invitationMotion = {
  fold: 1100,
  stagger: 100,
  entry: 750,
  reveal: 650,
  fallbackGrace: 250,
  imageWait: 3500,
} as const;

export const invitationMotionStyle = {
  "--invitation-fold-duration": `${invitationMotion.fold}ms`,
  "--invitation-fold-stagger": `${invitationMotion.stagger}ms`,
  "--invitation-entry-duration": `${invitationMotion.entry}ms`,
  "--invitation-reveal-duration": `${invitationMotion.reveal}ms`,
  "--invitation-easing": "cubic-bezier(.22, 1, .36, 1)",
} as CSSProperties;
