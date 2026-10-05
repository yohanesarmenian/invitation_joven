"use client";
import {
  createInvitationApiClient,
  type UpdateAdminGuestMessageRequest,
  type UpdateAdminGuestMessageResponse,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode, FORBIDDEN } from "../auth/auth-state";
import { isGuestMessageItem } from "./contract";

export const UNCERTAIN_MESSAGE_MODERATION =
  "The message visibility change could not be confirmed. Reload the message list before deciding whether another explicit action is needed.";

export type ModerateMessageResult =
  | { kind: "updated"; data: UpdateAdminGuestMessageResponse }
  | { kind: "validation" | "not-found" | "session-ended" | "uncertain" }
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

const messagePath = (messageId: string) =>
  `/api/admin/messages/${encodeURIComponent(messageId)}` as "/api/admin/messages/{messageId}";

async function csrfRecovery(): Promise<RetrySession> {
  const session = await currentSession();
  if (session.kind === "unauthenticated") return { kind: "session-ended" };
  if (session.kind === "authenticated")
    return {
      kind: "csrf",
      csrfToken: session.auth.csrfToken,
      message:
        "Your session was refreshed. The message visibility change was not replayed. Review the row and submit again explicitly.",
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

export async function moderateGuestMessage(
  messageId: string,
  body: UpdateAdminGuestMessageRequest,
  csrfToken: string,
): Promise<ModerateMessageResult> {
  try {
    const { data, error, response } = await client().PATCH(
      messagePath(messageId),
      {
        body,
        headers: { "X-CSRF-Token": csrfToken },
      },
    );
    if (response.status === 200)
      return isGuestMessageItem(data)
        ? { kind: "updated", data }
        : { kind: "uncertain" };
    if (response.status === 401) return { kind: "session-ended" };
    if (response.status === 403 && errorCode(error) === "CSRF_INVALID")
      return csrfRecovery();
    if (response.status === 403)
      return { kind: "rejected", message: FORBIDDEN };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 400 && errorCode(error) === "VALIDATION_ERROR")
      return { kind: "validation" };
    return { kind: "uncertain" };
  } catch {
    return { kind: "uncertain" };
  }
}
