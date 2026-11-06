"use client";
import {
  createInvitationApiClient,
  type CreateAdminInvitationRequest,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode, FORBIDDEN } from "../auth/auth-state";
import { safeInvitationUrl } from "./create-workflow";

export const UNCERTAIN_CREATE =
  "The creation result could not be confirmed. Check the invitations list before attempting another create; the invitation may already exist.";
export type CreateResult =
  | { kind: "created"; invitationId: string; publicUrl: string }
  | { kind: "session-ended" }
  | { kind: "uncertain" }
  | { kind: "rejected"; message: string }
  | { kind: "csrf"; csrfToken: string }
  | { kind: "reload"; message: string };
export async function createInvitation(
  body: CreateAdminInvitationRequest,
  csrfToken: string,
): Promise<CreateResult> {
  try {
    const client = createInvitationApiClient({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    const { data, error, response } = await client.POST(
      "/api/admin/invitations",
      { body, headers: { "X-CSRF-Token": csrfToken } },
    );
    if (response.status === 201) {
      // Keep only the verified acknowledgement in this mounted OWNER form.
      // Never persist the bearer URL or copy it into the admin router.
      return data &&
        typeof data.invitation?.id === "string" &&
        /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(data.invitation.id) &&
        data.publicTokenVersion === 1 &&
        safeInvitationUrl(data.publicUrl)
        ? {
            kind: "created",
            invitationId: data.invitation.id,
            publicUrl: data.publicUrl,
          }
        : { kind: "uncertain" };
    }
    if (response.status === 401) return { kind: "session-ended" };
    const code = errorCode(error);
    if (response.status === 403 && code === "CSRF_INVALID") {
      const session = await currentSession();
      if (session.kind === "unauthenticated") return { kind: "session-ended" };
      if (session.kind === "authenticated")
        return { kind: "csrf", csrfToken: session.auth.csrfToken };
      return {
        kind: "reload",
        message:
          session.kind === "forbidden"
            ? FORBIDDEN
            : "Unable to refresh your session. Reload this page before trying again.",
      };
    }
    if (response.status === 403)
      return { kind: "rejected", message: FORBIDDEN };
    if (response.status === 400 && code === "VALIDATION_ERROR")
      return {
        kind: "rejected",
        message:
          "The invitation was not accepted. Review the fields and selected events, then submit again.",
      };
    if (response.status === 409 && code === "CONFLICT")
      return {
        kind: "rejected",
        message:
          "The invitation could not be created because the current data conflicts. Review your entries and reload the event options before submitting again.",
      };
    // The backend can commit before response serialization fails. Any unknown
    // outcome, including 5xx, must block another POST from this form.
    return { kind: "uncertain" };
  } catch {
    return { kind: "uncertain" };
  }
}
