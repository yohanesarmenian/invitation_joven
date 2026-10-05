"use client";
import {
  createInvitationApiClient,
  type AdminInvitationDetailResponse,
  type AdminInvitationPublicUrlResponse,
  type ArchiveAdminInvitationResponse,
  type UpdateAdminInvitationRequest,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode, FORBIDDEN } from "../auth/auth-state";
import { isInvitationDetail, isPublicUrl } from "./contract";

export const UNCERTAIN_REGENERATION =
  "The link may already have been regenerated. Refresh the current public link before attempting another regeneration.";

type RetrySession =
  | { kind: "csrf"; csrfToken: string; message: string }
  | { kind: "session-ended" }
  | { kind: "rejected"; message: string; reload?: boolean };

export type UpdateInvitationResult =
  | { kind: "updated"; data: AdminInvitationDetailResponse }
  | { kind: "conflict" }
  | { kind: "validation" }
  | { kind: "not-found" | "session-ended" | "uncertain" }
  | { kind: "csrf"; csrfToken: string; message: string }
  | { kind: "rejected"; message: string; reload?: boolean };

export type ArchiveInvitationResult =
  | { kind: "archived"; data: ArchiveAdminInvitationResponse }
  | { kind: "not-found" | "session-ended" | "conflict" | "uncertain" }
  | { kind: "csrf"; csrfToken: string; message: string }
  | { kind: "rejected"; message: string; reload?: boolean };

export type PublicUrlResult =
  | { kind: "loaded"; data: AdminInvitationPublicUrlResponse }
  | { kind: "not-found" | "archived" | "session-ended" | "unavailable" }
  | { kind: "rejected"; message: string };

export type RegenerateTokenResult =
  | { kind: "regenerated"; data: AdminInvitationPublicUrlResponse }
  | { kind: "conflict" | "not-found" | "session-ended" | "uncertain" }
  | { kind: "csrf"; csrfToken: string; message: string }
  | { kind: "rejected"; message: string; reload?: boolean };

function client() {
  return createInvitationApiClient({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
}
const invitationPath = (invitationId: string) =>
  `/api/admin/invitations/${encodeURIComponent(invitationId)}` as "/api/admin/invitations/{invitationId}";
const archivePath = (invitationId: string) =>
  `/api/admin/invitations/${encodeURIComponent(invitationId)}/archive` as "/api/admin/invitations/{invitationId}/archive";
const publicUrlPath = (invitationId: string) =>
  `/api/admin/invitations/${encodeURIComponent(invitationId)}/public-url` as "/api/admin/invitations/{invitationId}/public-url";
const regeneratePath = (invitationId: string) =>
  `/api/admin/invitations/${encodeURIComponent(invitationId)}/regenerate-token` as "/api/admin/invitations/{invitationId}/regenerate-token";

async function csrfRecovery(): Promise<RetrySession> {
  const session = await currentSession();
  if (session.kind === "unauthenticated") return { kind: "session-ended" };
  if (session.kind === "authenticated")
    return {
      kind: "csrf",
      csrfToken: session.auth.csrfToken,
      message:
        "Your session was refreshed. The previous action was not replayed. Review the state and submit again explicitly.",
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

function archiveResponse(v: unknown): v is ArchiveAdminInvitationResponse {
  return (
    typeof v === "object" &&
    v !== null &&
    "invitation" in v &&
    typeof v.invitation === "object" &&
    v.invitation !== null &&
    "id" in v.invitation &&
    typeof v.invitation.id === "string" &&
    "status" in v.invitation &&
    v.invitation.status === "ARCHIVED" &&
    "archivedAt" in v.invitation &&
    typeof v.invitation.archivedAt === "string" &&
    Number.isFinite(Date.parse(v.invitation.archivedAt))
  );
}

export async function updateInvitation(
  invitationId: string,
  body: UpdateAdminInvitationRequest,
  csrfToken: string,
): Promise<UpdateInvitationResult> {
  try {
    const { data, error, response } = await client().PATCH(
      invitationPath(invitationId),
      {
        body,
        headers: { "X-CSRF-Token": csrfToken },
      },
    );
    if (response.status === 200)
      return isInvitationDetail(data)
        ? { kind: "updated", data }
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

export async function archiveInvitation(
  invitationId: string,
  csrfToken: string,
): Promise<ArchiveInvitationResult> {
  try {
    const { data, error, response } = await client().POST(
      archivePath(invitationId),
      {
        headers: { "X-CSRF-Token": csrfToken },
      },
    );
    if (response.status === 200)
      return archiveResponse(data)
        ? { kind: "archived", data }
        : { kind: "uncertain" };
    if (response.status === 401) return { kind: "session-ended" };
    if (response.status === 403 && errorCode(error) === "CSRF_INVALID")
      return csrfRecovery();
    if (response.status === 403)
      return { kind: "rejected", message: FORBIDDEN };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 409) return { kind: "conflict" };
    return { kind: "uncertain" };
  } catch {
    return { kind: "uncertain" };
  }
}

export async function loadPublicUrl(
  invitationId: string,
): Promise<PublicUrlResult> {
  try {
    const { data, response } = await client().GET(publicUrlPath(invitationId));
    if (response.status === 200)
      return isPublicUrl(data)
        ? { kind: "loaded", data }
        : { kind: "unavailable" };
    if (response.status === 401) return { kind: "session-ended" };
    if (response.status === 403)
      return { kind: "rejected", message: FORBIDDEN };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 409) return { kind: "archived" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function regenerateInvitationToken(
  invitationId: string,
  expectedTokenVersion: number,
  csrfToken: string,
): Promise<RegenerateTokenResult> {
  try {
    const { data, error, response } = await client().POST(
      regeneratePath(invitationId),
      {
        body: { expectedTokenVersion },
        headers: { "X-CSRF-Token": csrfToken },
      },
    );
    if (response.status === 200)
      return isPublicUrl(data)
        ? { kind: "regenerated", data }
        : { kind: "uncertain" };
    if (response.status === 401) return { kind: "session-ended" };
    if (response.status === 403 && errorCode(error) === "CSRF_INVALID")
      return csrfRecovery();
    if (response.status === 403)
      return { kind: "rejected", message: FORBIDDEN };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 409) return { kind: "conflict" };
    return { kind: "uncertain" };
  } catch {
    return { kind: "uncertain" };
  }
}
