"use client";
import {
  createInvitationApiClient,
  type AdminRsvpDetailResponse,
  type OverrideAdminRsvpRequest,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode, FORBIDDEN } from "../auth/auth-state";
import { isRsvpDetail } from "./contract";

export const UNCERTAIN_RSVP_OVERRIDE =
  "The RSVP override result could not be confirmed. Reload the current RSVP detail before deciding whether another explicit override is needed.";

export type OverrideRsvpResult =
  | { kind: "overridden"; data: AdminRsvpDetailResponse }
  | { kind: "conflict" | "validation" | "not-found" | "session-ended" | "uncertain" }
  | { kind: "csrf"; csrfToken: string; message: string }
  | { kind: "rejected"; message: string; reload?: boolean };
type RetrySession =
  | { kind: "csrf"; csrfToken: string; message: string }
  | { kind: "session-ended" }
  | { kind: "rejected"; message: string; reload?: boolean };

function client() {
  return createInvitationApiClient({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
}

const overridePath = (invitationId: string) =>
  `/api/admin/invitations/${encodeURIComponent(invitationId)}/rsvp` as "/api/admin/invitations/{invitationId}/rsvp";

async function csrfRecovery(): Promise<RetrySession> {
  const session = await currentSession();
  if (session.kind === "unauthenticated") return { kind: "session-ended" };
  if (session.kind === "authenticated")
    return {
      kind: "csrf",
      csrfToken: session.auth.csrfToken,
      message:
        "Your session was refreshed. The RSVP override was not replayed. Review the form and submit again explicitly.",
    };
  return {
    kind: "rejected",
    message:
      session.kind === "forbidden"
        ? FORBIDDEN
        : "Unable to refresh your session. Reload this page before trying again.",
    reload: true,
  };
}

export async function overrideRsvp(
  invitationId: string,
  body: OverrideAdminRsvpRequest,
  csrfToken: string,
): Promise<OverrideRsvpResult> {
  try {
    const { data, error, response } = await client().PUT(
      overridePath(invitationId),
      {
        body,
        headers: { "X-CSRF-Token": csrfToken },
      },
    );
    if (response.status === 200)
      return isRsvpDetail(data)
        ? { kind: "overridden", data }
        : { kind: "uncertain" };
    if (response.status === 401) return { kind: "session-ended" };
    if (response.status === 403 && errorCode(error) === "CSRF_INVALID")
      return csrfRecovery();
    if (response.status === 403)
      return { kind: "rejected", message: FORBIDDEN };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 409) return { kind: "conflict" };
    if (response.status === 400 && errorCode(error) === "VALIDATION_ERROR")
      return { kind: "validation" };
    return { kind: "uncertain" };
  } catch {
    return { kind: "uncertain" };
  }
}
