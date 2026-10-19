"use client";
import {
  createInvitationApiClient,
  type ApiComponents,
  type AdminEventsResponse,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode } from "../auth/auth-state";
import { isEvents } from "../invitations/contract";
import { isAdminVenueState } from "../../../invitation-web/src/content/venue-api";
export type State = ApiComponents["schemas"]["AdminEventContentDto"];
export type Body = ApiComponents["schemas"]["EventVenueBodyDto"];
export type Result<T> =
  | { kind: "ok"; data: T }
  | { kind: "error"; code: string; csrfToken?: string }
  | { kind: "uncertain" };
const client = () =>
  createInvitationApiClient({
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
const options = (csrfToken: string) => ({
  headers: { "X-CSRF-Token": csrfToken },
  signal: AbortSignal.timeout(30_000),
});
async function run<T>(
  call: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
  guard: (v: unknown) => v is T,
  mutation = false,
): Promise<Result<T>> {
  try {
    const { data, error, response } = await call();
    if (response.ok && guard(data)) return { kind: "ok", data };
    if (response.status === 401)
      return { kind: "error", code: "UNAUTHENTICATED" };
    const code = errorCode(error);
    if (response.status === 403 && code === "CSRF_INVALID") {
      const session = await currentSession();
      return {
        kind: "error",
        code:
          session.kind === "unauthenticated"
            ? "UNAUTHENTICATED"
            : "CSRF_INVALID",
        ...(session.kind === "authenticated"
          ? { csrfToken: session.auth.csrfToken }
          : {}),
      };
    }
    if ([400, 403, 404, 409, 413].includes(response.status))
      return { kind: "error", code: String(response.status) };
  } catch {
    /* fixed outcome only; no payload logging or mutation replay */
  }
  return mutation
    ? { kind: "uncertain" }
    : { kind: "error", code: "UNAVAILABLE" };
}
export const events = (): Promise<Result<AdminEventsResponse>> =>
  run(
    () =>
      client().GET("/api/admin/events", {
        signal: AbortSignal.timeout(20_000),
      }),
    isEvents,
  );
export const read = (eventId: string) =>
  run(
    () =>
      client().GET("/api/admin/event-content/{eventId}", {
        params: { path: { eventId } },
        signal: AbortSignal.timeout(20_000),
      }),
    isAdminVenueState,
  );
export const save = (
  eventId: string,
  expectedVersion: number,
  content: Body,
  csrf: string,
) =>
  run(
    () =>
      client().PUT("/api/admin/event-content/{eventId}", {
        ...options(csrf),
        params: { path: { eventId } },
        body: { expectedVersion, content },
      }),
    isAdminVenueState,
    true,
  );
export const publish = (
  eventId: string,
  expectedVersion: number,
  csrf: string,
) =>
  run(
    () =>
      client().POST("/api/admin/event-content/{eventId}/publish", {
        ...options(csrf),
        params: { path: { eventId } },
        body: { expectedVersion },
      }),
    isAdminVenueState,
    true,
  );
export const hide = (eventId: string, expectedVersion: number, csrf: string) =>
  run(
    () =>
      client().POST("/api/admin/event-content/{eventId}/hide", {
        ...options(csrf),
        params: { path: { eventId } },
        body: { expectedVersion },
      }),
    isAdminVenueState,
    true,
  );
export const remove = (
  eventId: string,
  assetId: string,
  expectedVersion: number,
  csrf: string,
) =>
  run(
    () =>
      client().DELETE("/api/admin/event-content/{eventId}/assets/{assetId}", {
        ...options(csrf),
        params: { path: { eventId, assetId } },
        body: { expectedVersion },
      }),
    isAdminVenueState,
    true,
  );
export function upload(
  eventId: string,
  expectedVersion: number,
  file: File,
  csrf: string,
) {
  const form = new FormData();
  form.append("file", file);
  return run(
    () =>
      client().POST("/api/admin/event-content/{eventId}/assets", {
        ...options(csrf),
        params: { path: { eventId }, query: { expectedVersion } },
        body: { file: file.name },
        bodySerializer: () => form,
      }),
    isAdminVenueState,
    true,
  );
}
