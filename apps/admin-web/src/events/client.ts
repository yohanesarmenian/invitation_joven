"use client";
import {
  createInvitationApiClient,
  type ApiComponents,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode } from "../auth/auth-state";
export type EventFields = ApiComponents["schemas"]["EventFieldsDto"];
export type ManagedEvent = ApiComponents["schemas"]["ManagedEventDto"];
export type Result<T> =
  | { kind: "ok"; data: T }
  | { kind: "error"; code: string; csrfToken?: string }
  | { kind: "uncertain" };
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nullableText = (v: unknown) => v === null || typeof v === "string";
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export function isManagedEvent(v: unknown): v is ManagedEvent {
  return (
    object(v) &&
    typeof v.id === "string" &&
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(v.id) &&
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    [v.description, v.venueName, v.address, v.googleMapsUrl].every(
      nullableText,
    ) &&
    [v.startsAt, v.endsAt].every(
      (t) =>
        t === null || (typeof t === "string" && Number.isFinite(Date.parse(t))),
    ) &&
    integer(v.displayOrder) &&
    integer(v.version) &&
    Number(v.version) > 0 &&
    typeof v.isActive === "boolean" &&
    object(v.usage) &&
    [v.usage.invitations, v.usage.rsvps, v.usage.checkins].every(integer)
  );
}
const client = () =>
  createInvitationApiClient({
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
async function run<T>(
  call: () => Promise<{ data?: unknown; error?: unknown; response: Response }>,
  guard: (value: unknown) => value is T,
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
    if ([400, 403, 404, 409].includes(response.status))
      return { kind: "error", code: code ?? String(response.status) };
  } catch {
    /* Do not log payloads or replay a mutation. */
  }
  return mutation
    ? { kind: "uncertain" }
    : { kind: "error", code: "UNAVAILABLE" };
}
export const list = () =>
  run(
    () =>
      client().GET("/api/admin/event-management", {
        signal: AbortSignal.timeout(20_000),
      }),
    (v): v is { items: ManagedEvent[] } =>
      object(v) && Array.isArray(v.items) && v.items.every(isManagedEvent),
  );
export const save = (
  body: EventFields,
  csrf: string,
  saved: ManagedEvent | null,
) =>
  run(
    () =>
      saved
        ? client().PUT("/api/admin/event-management/{eventId}", {
            params: { path: { eventId: saved.id } },
            body: { ...body, expectedVersion: saved.version },
            headers: { "X-CSRF-Token": csrf },
            signal: AbortSignal.timeout(30_000),
          })
        : client().POST("/api/admin/event-management", {
            body,
            headers: { "X-CSRF-Token": csrf },
            signal: AbortSignal.timeout(30_000),
          }),
    isManagedEvent,
    true,
  );

// datetime-local has no zone. Always attach WIB explicitly; preserve seconds
// and milliseconds when loading existing instants into this editor.
export function toWib(value: string | null): string {
  return value
    ? new Date(Date.parse(value) + 7 * 3_600_000).toISOString().slice(0, 23)
    : "";
}
export function fromWib(value: string): string | null {
  return value ? `${value.length === 16 ? value + ":00" : value}+07:00` : null;
}
