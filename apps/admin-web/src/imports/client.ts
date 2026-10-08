"use client";
import {
  createInvitationApiClient,
  type ValidateGuestImportRequest,
  type GuestImportValidateResponse,
  type GuestImportCommitRequest,
  type GuestImportCommitResponse,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode, FORBIDDEN } from "../auth/auth-state";
import { isPreview, isReceipt } from "./contract";

export type ImportRejection =
  | { kind: "rejected"; message: string; newPreview?: boolean }
  | { kind: "csrf"; csrfToken: string; message: string }
  | { kind: "session-ended" };
export type ValidateResult =
  { kind: "preview"; preview: GuestImportValidateResponse } | ImportRejection;
export type CommitResult =
  | { kind: "success"; receipt: GuestImportCommitResponse }
  | { kind: "uncertain" }
  | ImportRejection;
function client() {
  return createInvitationApiClient({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
}
async function rejection(
  status: number,
  error: unknown,
): Promise<ImportRejection | null> {
  const code = errorCode(error);
  if (status === 401) return { kind: "session-ended" };
  if (status === 403 && code === "CSRF_INVALID") {
    const session = await currentSession();
    if (session.kind === "unauthenticated") return { kind: "session-ended" };
    if (session.kind === "authenticated")
      return {
        kind: "csrf",
        csrfToken: session.auth.csrfToken,
        message:
          "Your session was refreshed. No upload or commit was replayed. Try the action again explicitly.",
      };
    return {
      kind: "rejected",
      message:
        session.kind === "forbidden"
          ? FORBIDDEN
          : "Unable to refresh your session. Try again explicitly when your connection is available.",
    };
  }
  if (status === 403) return { kind: "rejected", message: FORBIDDEN };
  if (status === 400 && code === "VALIDATION_ERROR")
    return {
      kind: "rejected",
      message:
        "Validation was rejected. Review the file format and row selection before trying again.",
    };
  if (status === 409) {
    const messages: Record<string, string> = {
      IMPORT_PREVIEW_STALE:
        "This preview is stale. Validate the file again and review the new preview.",
      IMPORT_PREVIEW_EXPIRED:
        "This preview has expired. Validate the file again.",
      IMPORT_PREVIEW_ALREADY_COMMITTED:
        "This preview was already committed with a different selection. Which rows were imported cannot be confirmed here. Check the invitation list before starting another import.",
    };
    if (code && messages[code])
      return { kind: "rejected", message: messages[code], newPreview: true };
  }
  return null;
}
export async function validateImport(
  file: File,
  csrfToken: string,
): Promise<ValidateResult> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    // OpenAPI represents binary as string. This operation-local serializer is
    // the narrow bridge: only native FormData reaches fetch, never this descriptor.
    const descriptor: ValidateGuestImportRequest = { file: file.name };
    const { data, error, response } = await client().POST(
      "/api/admin/imports/guest/validate",
      {
        body: descriptor,
        bodySerializer: () => formData,
        headers: { "X-CSRF-Token": csrfToken },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (response.status === 201 && isPreview(data))
      return { kind: "preview", preview: data };
    return (
      (await rejection(response.status, error)) ?? {
        kind: "rejected",
        message:
          "Unable to obtain a valid preview. Check the file and validate again explicitly.",
      }
    );
  } catch {
    return {
      kind: "rejected",
      message:
        "The preview could not be confirmed. No invitations are created by validation. Validate again explicitly.",
    };
  }
}
export async function commitImport(
  body: GuestImportCommitRequest,
  csrfToken: string,
): Promise<CommitResult> {
  try {
    const { data, error, response } = await client().POST(
      "/api/admin/imports/guest/commit",
      {
        body,
        headers: { "X-CSRF-Token": csrfToken },
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (response.status === 200 && isReceipt(data))
      return { kind: "success", receipt: data };
    return (await rejection(response.status, error)) ?? { kind: "uncertain" };
  } catch {
    return { kind: "uncertain" };
  }
}
