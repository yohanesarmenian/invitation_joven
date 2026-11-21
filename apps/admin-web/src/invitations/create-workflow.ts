import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";
import type { CreateFields } from "./form-state";

export const CREATE_PENDING_KEY = "invitation-create-pending";

export function activeWeddingSessions(events: AdminEventsResponse["events"]) {
  return events.filter((event) => event.isActive);
}

export function weddingEventIssue(
  events: AdminEventsResponse["events"],
): string | null {
  if (!events.length)
    return "The wedding event is missing. Ask the operator to check the existing wedding configuration. No invitation has been created.";
  const active = activeWeddingSessions(events);
  if (!active.length)
    return "No wedding session is active. Open Events to review the wedding sessions before creating invitations.";
  if (active.some((event) => !event.name.trim() || !event.slug.trim()))
    return "An active wedding session has an invalid name or identifier. Open Events to review its configuration.";
  return null;
}

export function initialCreateFields(
  events: AdminEventsResponse["events"],
): CreateFields {
  const active = activeWeddingSessions(events);
  return {
    displayName: "",
    greetingName: "",
    allowPlusOne: false,
    children: "0",
    deadline: "",
    notes: "",
    eventIds:
      active.length === 1 && !weddingEventIssue(events) ? [active[0]!.id] : [],
    invitees: [{ fullName: "", category: "ADULT", label: "" }],
  };
}

export function withGuestDisplayName(fields: CreateFields): CreateFields {
  return {
    ...fields,
    displayName:
      fields.displayName.trim() || fields.invitees[0]?.fullName.trim() || "",
  };
}

// Only an authorized server response supplies the bearer link. Never put it in
// router/query state, local/session storage, diagnostics, or an analytics event.
export function safeInvitationUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      (url.protocol === "https:" || (loopback && url.protocol === "http:")) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/i\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function whatsappInvitationUrl(publicUrl: string): string | null {
  return safeInvitationUrl(publicUrl)
    ? "https://wa.me/?text=" +
        encodeURIComponent(
          "You are invited. Please open your invitation: " + publicUrl,
        )
    : null;
}
