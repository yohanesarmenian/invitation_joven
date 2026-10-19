"use client";
import { createInvitationApiClient } from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode } from "../auth/auth-state";
import {
  isEvents,
  isPreview,
  isSearch,
  isReceipt,
  isManualStatus,
} from "./contract";

export type Failure =
  { kind: "error"; code: string; csrfToken?: string } | { kind: "uncertain" };
export type Result<T> = { kind: "ok"; data: T } | Failure;
const client = () =>
  createInvitationApiClient({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
async function finish<T>(
  request: () => Promise<{
    data?: unknown;
    error?: unknown;
    response: Response;
  }>,
  guard: (v: unknown) => v is T,
  mutation = false,
): Promise<Result<T>> {
  try {
    const { data, error, response } = await request();
    if (response.ok && guard(data)) return { kind: "ok", data };
    if (response.status === 401)
      return { kind: "error", code: "UNAUTHENTICATED" };
    if (response.status === 403 && errorCode(error) === "CSRF_INVALID") {
      const session = await currentSession();
      if (session.kind === "unauthenticated")
        return { kind: "error", code: "UNAUTHENTICATED" };
      return {
        kind: "error",
        code: "CSRF_INVALID",
        ...(session.kind === "authenticated"
          ? { csrfToken: session.auth.csrfToken }
          : {}),
      };
    }
    if (response.status === 403) return { kind: "error", code: "FORBIDDEN" };
    const code = errorCode(error);
    if ([400, 404, 409, 422].includes(response.status) && code)
      return { kind: "error", code };
    return mutation
      ? { kind: "uncertain" }
      : { kind: "error", code: "NETWORK_ERROR" };
  } catch {
    return mutation
      ? { kind: "uncertain" }
      : { kind: "error", code: "NETWORK_ERROR" };
  }
}
const options = (csrf: string) => ({
  headers: { "X-CSRF-Token": csrf },
  signal: AbortSignal.timeout(20_000),
});
export const loadEvents = () =>
  finish(
    () =>
      client().GET("/api/admin/checkin/events", {
        signal: AbortSignal.timeout(20_000),
      }),
    isEvents,
  );
export const validateQr = (qrPayload: string, eventId: string, csrf: string) =>
  finish(
    () =>
      client().POST("/api/admin/checkin/validate", {
        ...options(csrf),
        body: { qrPayload, eventId },
      }),
    isPreview,
  );
export const searchHouseholds = (query: string, eventId: string) =>
  finish(
    () =>
      client().GET("/api/admin/checkin/search", {
        params: { query: { query, eventId } },
        signal: AbortSignal.timeout(20_000),
      }),
    isSearch,
  );
export const confirmQr = (
  qrPayload: string,
  eventId: string,
  attendeeCount: number,
  csrf: string,
) =>
  finish(
    () =>
      client().POST("/api/admin/checkin/confirm", {
        ...options(csrf),
        body: { qrPayload, eventId, attendeeCount },
      }),
    isReceipt,
    true,
  );
export const confirmManual = (
  invitationId: string,
  eventId: string,
  attendeeCount: number,
  csrf: string,
) =>
  finish(
    () =>
      client().POST("/api/admin/checkin/manual-confirm", {
        ...options(csrf),
        body: { invitationId, eventId, attendeeCount },
      }),
    isReceipt,
    true,
  );
export const readManualStatus = (
  invitationId: string,
  eventId: string,
  csrf: string,
) =>
  finish(
    () =>
      client().POST("/api/admin/checkin/manual-status", {
        ...options(csrf),
        body: { invitationId, eventId },
      }),
    isManualStatus,
  );
