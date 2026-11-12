"use client";
import {
  createInvitationApiClient,
  type ReceptionArrival,
  type ReceptionArrivalRequest,
  type ReceptionDetail,
  type ReceptionReceipt,
  type ReceptionSearch,
  type ReceptionStatistics,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode } from "../auth/auth-state";
import { isUuid } from "../invitations/contract";
import type {
  WalkinRequest,
  AttendanceActionRequest,
  ReceptionActionReceipt,
} from "@wedding-invitation/api-client/src/index";
export type Result<T> =
  | { kind: "ok"; data: T }
  | { kind: "error"; code: string; csrfToken?: string }
  | { kind: "uncertain" };
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function safe(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(safe);
  if (!object(v)) return true;
  return Object.entries(v).every(
    ([key, value]) =>
      ![
        "qrPayload",
        "tokenHash",
        "publicTokenHash",
        "passwordHash",
        "payloadHash",
        "sessionToken",
        "publicCredential",
        "publicUrl",
        "sessionTokenHash",
        "password",
        "csrfToken",
      ].includes(key) && safe(value),
  );
}
export const isArrival = (v: unknown): v is ReceptionArrival =>
  object(v) &&
  safe(v) &&
  isUuid(v.operationId) &&
  count(v.attendeeCount) &&
  Number(v.attendeeCount) > 0 &&
  count(v.totalAfter) &&
  count(v.expectedAttendeeCount) &&
  Number(v.totalAfter) <= Number(v.expectedAttendeeCount) &&
  typeof v.checkedInAt === "string" &&
  Number.isFinite(Date.parse(v.checkedInAt)) &&
  (v.method === "QR" || v.method === "MANUAL") &&
  isUuid(v.operatorId) &&
  typeof v.actorRole === "string" &&
  typeof v.verificationMethod === "string" &&
  (v.reason === null || typeof v.reason === "string") &&
  typeof v.migrated === "boolean";
export const isHousehold = (v: unknown): v is ReceptionDetail["household"] =>
  object(v) &&
  safe(v) &&
  isUuid(v.id) &&
  typeof v.displayName === "string" &&
  typeof v.referenceCode === "string" &&
  /^HJ-\d{6,}$/.test(v.referenceCode) &&
  ["PENDING", "ACCEPTED", "DECLINED"].includes(String(v.rsvpStatus)) &&
  (v.rsvpVersion === null || Number.isSafeInteger(v.rsvpVersion)) &&
  typeof v.eligible === "boolean" &&
  typeof v.rsvpLocked === "boolean" &&
  ["REGISTERED", "WALKIN"].includes(String(v.source)) &&
  [
    v.baseExpectedCount,
    v.exceptionAllowance,
    v.attendanceRevision,
    v.unnamedCompanionAllowance,
  ].every(count) &&
  [
    v.allowedCount,
    v.expectedCount,
    v.arrivedCount,
    v.remainingCount,
    v.maxAdditionalChildren,
  ].every(count) &&
  typeof v.allowPlusOne === "boolean" &&
  Array.isArray(v.invitees) &&
  v.invitees.every(
    (i) => object(i) && isUuid(i.id) && typeof i.fullName === "string",
  );
export const isDetail = (v: unknown): v is ReceptionDetail =>
  object(v) &&
  safe(v) &&
  isHousehold(v.household) &&
  Array.isArray(v.arrivals) &&
  v.arrivals.every(isArrival) &&
  Array.isArray(v.actions) &&
  v.actions.every(
    (a) =>
      object(a) &&
      isUuid(a.operationId) &&
      ["WALKIN", "CORRECTION", "EXCEPTION"].includes(String(a.kind)) &&
      Number.isSafeInteger(a.delta) &&
      count(a.capacityDelta) &&
      typeof a.reason === "string" &&
      isUuid(a.operatorId) &&
      typeof a.createdAt === "string",
  ) &&
  (v.registration === null ||
    (object(v.registration) &&
      isUuid(v.registration.id) &&
      isUuid(v.registration.operationId) &&
      typeof v.registration.leadName === "string" &&
      typeof v.registration.affiliation === "string" &&
      [
        v.registration.companionCount,
        v.registration.expectedCount,
        v.registration.arrivingCount,
      ].every(count)));
const isSearch = (v: unknown): v is ReceptionSearch =>
  object(v) &&
  safe(v) &&
  Array.isArray(v.items) &&
  v.items.length <= 25 &&
  v.items.every(isHousehold) &&
  count(v.page) &&
  typeof v.hasMore === "boolean";
const isReceipt = (v: unknown): v is ReceptionReceipt =>
  object(v) && safe(v) && isArrival(v.arrival);
const isOperation = (v: unknown): v is { arrival: ReceptionArrival | null } =>
  object(v) && safe(v) && (v.arrival === null || isArrival(v.arrival));
const statsKeys = [
  "walkinHouseholds",
  "registeredExpectedGuests",
  "walkinExpectedGuests",
  "walkinArrivedGuests",
  "correctionOperations",
  "exceptionalGuests",
  "registeredHouseholds",
  "pendingHouseholds",
  "acceptedHouseholds",
  "declinedHouseholds",
  "expectedGuests",
  "arrivedGuests",
  "partialHouseholds",
  "completedHouseholds",
  "qrGuests",
  "manualGuests",
  "onSiteConfirmations",
];
const isStats = (v: unknown): v is ReceptionStatistics =>
  object(v) && safe(v) && statsKeys.every((key) => count(v[key]));
const client = () =>
  createInvitationApiClient({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
const isActionReceipt = (v: unknown): v is ReceptionActionReceipt =>
  object(v) &&
  safe(v) &&
  isUuid(v.operationId) &&
  isUuid(v.invitationId) &&
  isUuid(v.eventId) &&
  isUuid(v.operatorId) &&
  ["WALKIN", "CORRECTION", "EXCEPTION"].includes(String(v.kind)) &&
  typeof v.displayName === "string" &&
  typeof v.referenceCode === "string" &&
  [v.arrivedCount, v.expectedCount, v.remainingCount, v.capacityDelta].every(
    count,
  ) &&
  Number(v.arrivedCount) <= Number(v.expectedCount) &&
  Number(v.remainingCount) ===
    Number(v.expectedCount) - Number(v.arrivedCount) &&
  Number.isSafeInteger(v.delta) &&
  typeof v.confirmedAt === "string" &&
  Number.isFinite(Date.parse(v.confirmedAt));
const isActionStatus = (
  v: unknown,
): v is { receipt: ReceptionActionReceipt | null } =>
  object(v) && safe(v) && (v.receipt === null || isActionReceipt(v.receipt));
const unsafe = (csrf: string) => ({
  headers: { "X-CSRF-Token": csrf },
  signal: AbortSignal.timeout(20000),
});
async function run<T>(
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
    if ([400, 403, 404, 409, 422, 429].includes(response.status))
      return { kind: "error", code: errorCode(error) ?? "REJECTED" };
    return mutation
      ? { kind: "uncertain" }
      : { kind: "error", code: "NETWORK_ERROR" };
  } catch {
    return mutation
      ? { kind: "uncertain" }
      : { kind: "error", code: "NETWORK_ERROR" };
  }
}
export const search = (query: string, eventId: string, page: number) =>
  run(
    () =>
      client().GET("/api/admin/reception/search", {
        params: { query: { query, eventId, page } },
        signal: AbortSignal.timeout(20000),
      }),
    isSearch,
  );
export const detail = (id: string, eventId: string) =>
  run(
    () =>
      client().GET("/api/admin/reception/households/{id}", {
        params: { path: { id }, query: { eventId } },
        signal: AbortSignal.timeout(20000),
      }),
    isDetail,
  );
export const identify = (qrPayload: string, eventId: string, csrf: string) =>
  run(
    () =>
      client().POST("/api/admin/reception/validate", {
        ...unsafe(csrf),
        body: { qrPayload, eventId },
      }),
    isDetail,
  );
export const arrive = (body: ReceptionArrivalRequest, csrf: string) =>
  run(
    () =>
      client().POST("/api/admin/reception/arrivals", { ...unsafe(csrf), body }),
    isReceipt,
    true,
  );
export const operation = (
  operationId: string,
  invitationId: string,
  eventId: string,
) =>
  run(
    () =>
      client().GET("/api/admin/reception/operations/{operationId}", {
        params: { path: { operationId }, query: { invitationId, eventId } },
        signal: AbortSignal.timeout(20000),
      }),
    isOperation,
  );
export const statistics = (eventId: string) =>
  run(
    () =>
      client().GET("/api/admin/reception/statistics", {
        params: { query: { eventId } },
        signal: AbortSignal.timeout(20000),
      }),
    isStats,
  );
export const registerWalkin = (body: WalkinRequest, csrf: string) =>
  run(
    () =>
      client().POST("/api/admin/reception/walkins", { ...unsafe(csrf), body }),
    isActionReceipt,
    true,
  );
export const adjustAttendance = (
  kind: "CORRECTION" | "EXCEPTION",
  body: AttendanceActionRequest,
  csrf: string,
) =>
  kind === "CORRECTION"
    ? run(
        () =>
          client().POST("/api/admin/reception/corrections", {
            ...unsafe(csrf),
            body,
          }),
        isActionReceipt,
        true,
      )
    : run(
        () =>
          client().POST("/api/admin/reception/exceptions", {
            ...unsafe(csrf),
            body,
          }),
        isActionReceipt,
        true,
      );
export const actionStatus = (operationId: string) =>
  run(
    () =>
      client().GET("/api/admin/reception/actions/{operationId}", {
        params: { path: { operationId } },
        signal: AbortSignal.timeout(20000),
      }),
    isActionStatus,
  );
