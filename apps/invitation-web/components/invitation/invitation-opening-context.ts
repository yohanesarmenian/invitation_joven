"use client";

import { createContext } from "react";

// Standalone gallery previews retain their normal image behavior.
export const InvitationContentVisible = createContext(true);

export type RsvpHeroAction = "rsvp" | "confirm" | "response";

export const RsvpHeroActionUpdate = createContext<
  ((action: RsvpHeroAction) => void) | null
>(null);

export const RSVP_RESPONSE_HEADING_ID = "rsvp-response-title";
export const CHECKIN_PASS_HEADING_ID = "checkin-pass-title";
