import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";
import type { CreateFields } from "./form-state";

export const CREATE_PENDING_KEY = "invitation-create-pending";

export function weddingEventIssue(
  events: AdminEventsResponse["events"],
): string | null {
  if (!events.length)
    return "The wedding event is missing. Ask the operator to check the existing wedding configuration. No invitation has been created.";
  if (events.length !== 1)
    return "More than one wedding event was returned. Ask the operator to identify the existing wedding event before creating invitations. No event has been changed.";
  if (!events[0]!.isActive)
    return "The wedding event is inactive. Ask the operator to review the existing event before creating invitations. No event has been changed.";
  if (!events[0]!.name.trim() || !events[0]!.slug.trim())
    return "The wedding event has an invalid name or identifier. Ask the operator to review its configuration.";
  return null;
}

export function initialCreateFields(
  events: AdminEventsResponse["events"],
): CreateFields {
  return {
    displayName: "",
    greetingName: "",
    allowPlusOne: false,
    children: "0",
    deadline: "",
    notes: "",
    eventIds: weddingEventIssue(events) ? [] : [events[0]!.id],
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
