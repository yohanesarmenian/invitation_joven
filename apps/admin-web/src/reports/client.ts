"use client";
import {
  createInvitationApiClient,
  type ApiComponents,
  type ApiPaths,
} from "@wedding-invitation/api-client/src/index";
import { errorCode } from "../auth/auth-state";
type Schemas = ApiComponents["schemas"];
export type Summary = Schemas["ReportSummaryDto"];
export type ReportList = Schemas["ReportListDto"];
export type Filters = NonNullable<
  ApiPaths["/api/admin/reports/summary"]["get"]["parameters"]["query"]
>;
export type ReportKind = NonNullable<
  NonNullable<
    ApiPaths["/api/admin/reports/households"]["get"]["parameters"]["query"]
  >["kind"]
>;
type Result<T> = { kind: "ok"; data: T } | { kind: "error"; code: string };
const obj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const count = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const time = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const nullableText = (v: unknown) => v === null || typeof v === "string";
export const isSummary = (v: unknown): v is Summary =>
  obj(v) &&
  time(v.generatedAt) &&
  (v.archived === "exclude" || v.archived === "include") &&
  Array.isArray(v.events) &&
  v.events.every(
    (e) =>
      obj(e) &&
      typeof e.id === "string" &&
      typeof e.name === "string" &&
      typeof e.isActive === "boolean" &&
      [
        e.expectedAttendeeCount,
        e.actualAttendeeCount,
        e.expectedHouseholds,
        e.checkedInHouseholds,
        e.notArrivedHouseholds,
      ].every(count),
  );
export const isReportList = (v: unknown): v is ReportList =>
  obj(v) &&
  time(v.generatedAt) &&
  obj(v.page) &&
  [v.page.number, v.page.pageSize, v.page.totalItems, v.page.totalPages].every(
    count,
  ) &&
  Array.isArray(v.items) &&
  v.items.every(
    (r) =>
      obj(r) &&
      typeof r.invitationId === "string" &&
      typeof r.displayName === "string" &&
      (r.invitationStatus === "ACTIVE" || r.invitationStatus === "ARCHIVED") &&
      ["PENDING", "ACCEPTED", "DECLINED"].includes(String(r.rsvpStatus)) &&
      count(r.rsvpHouseholdSize) &&
      nullableText(r.dietaryNotes) &&
      nullableText(r.eventId) &&
      nullableText(r.eventName) &&
      (r.expectedAttendeeCount === null || count(r.expectedAttendeeCount)) &&
      (r.actualAttendeeCount === null || count(r.actualAttendeeCount)) &&
      (r.checkedInAt === null || time(r.checkedInAt)) &&
      (r.method === null || r.method === "QR" || r.method === "MANUAL") &&
      nullableText(r.operatorEmail),
  );
const client = () =>
  createInvitationApiClient({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
async function run<T>(
  request: () => Promise<{
    data?: unknown;
    error?: unknown;
    response: Response;
  }>,
  guard: (v: unknown) => v is T,
): Promise<Result<T>> {
  try {
    const { data, error, response } = await request();
    if (response.ok && guard(data)) return { kind: "ok", data };
    return {
      kind: "error",
      code:
        response.status === 401
          ? "UNAUTHENTICATED"
          : response.status === 403
            ? "FORBIDDEN"
            : (errorCode(error) ?? "NETWORK_ERROR"),
    };
  } catch {
    return { kind: "error", code: "NETWORK_ERROR" };
  }
}
export const summary = (f: Filters) =>
  run(
    () =>
      client().GET("/api/admin/reports/summary", {
        params: { query: f },
        signal: AbortSignal.timeout(20_000),
      }),
    isSummary,
  );
export const list = (f: Filters, kind: ReportKind, page: number) =>
  run(
    () =>
      client().GET("/api/admin/reports/households", {
        params: { query: { ...f, kind, page, pageSize: 25 } },
        signal: AbortSignal.timeout(20_000),
      }),
    isReportList,
  );
export const exportCsv = (f: Filters, kind: ReportKind | "SUMMARY") =>
  run(
    () =>
      client().GET("/api/admin/reports/export", {
        params: { query: { ...f, kind } },
        parseAs: "text",
        signal: AbortSignal.timeout(30_000),
      }),
    (v): v is string =>
      (typeof v === "string" && v.startsWith('\ufeff"')) ||
      (typeof v === "string" && v.startsWith('"eventId"')) ||
      (typeof v === "string" && v.startsWith('"invitationId"')),
  );

export type RsvpPolicy = Schemas["RsvpPolicyDto"];
export type RsvpPolicyUpdate = Schemas["UpdateRsvpPolicyDto"];
export type CateringLive = Schemas["CateringLiveDto"];
export type CateringSnapshot = Schemas["CateringSnapshotDto"];
export type CateringComparison = Schemas["CateringComparisonDto"];
export type FreezeCatering = Schemas["FreezeCateringDto"];

function policyResponse(v: unknown): v is RsvpPolicy {
  return (
    obj(v) &&
    count(v.version) &&
    typeof v.allowLateEdits === "boolean" &&
    [v.initialDeadlineAt, v.finalEditDeadlineAt].every(
      (date) => date === null || time(date),
    ) &&
    count(v.activeExceptionCount) &&
    Array.isArray(v.activeExceptions) &&
    v.activeExceptions.every(
      (row) =>
        obj(row) &&
        typeof row.id === "string" &&
        typeof row.displayName === "string" &&
        time(row.rsvpDeadlineAt),
    )
  );
}

function snapshotResponse(v: unknown): v is CateringSnapshot {
  return (
    obj(v) &&
    count(v.version) &&
    count(v.schemaVersion) &&
    time(v.capturedAt) &&
    typeof v.capturedById === "string" &&
    nullableText(v.eventId) &&
    typeof v.includeArchived === "boolean"
  );
}

function isCateringTotals(v: unknown): v is Schemas["CateringTotalsDto"] {
  return (
    obj(v) &&
    [v.households, v.namedInvitees, v.accepted, v.declined, v.pending].every(
      count,
    ) &&
    Array.isArray(v.events) &&
    v.events.every(
      (row) =>
        obj(row) &&
        typeof row.id === "string" &&
        typeof row.name === "string" &&
        [
          row.expected,
          row.rsvpExpected,
          row.capacityAdjustment,
          row.actual,
          row.partialHouseholds,
          row.walkinActual,
        ].every(count),
    )
  );
}

export const rsvpPolicy = () =>
  run(
    () =>
      client().GET("/api/admin/rsvp-policy", {
        signal: AbortSignal.timeout(20_000),
      }),
    policyResponse,
  );

export const saveRsvpPolicy = (body: RsvpPolicyUpdate, csrf: string) =>
  run(
    () =>
      client().PUT("/api/admin/rsvp-policy", {
        body,
        headers: { "X-CSRF-Token": csrf },
        signal: AbortSignal.timeout(20_000),
      }),
    policyResponse,
  );

export const cateringLive = (
  query: NonNullable<
    ApiPaths["/api/admin/reports/catering/live"]["get"]["parameters"]["query"]
  >,
) =>
  run(
    () =>
      client().GET("/api/admin/reports/catering/live", {
        params: { query },
        signal: AbortSignal.timeout(20_000),
      }),
    (v): v is CateringLive =>
      obj(v) &&
      time(v.generatedAt) &&
      nullableText(v.eventId) &&
      typeof v.includeArchived === "boolean" &&
      isCateringTotals(v.totals),
  );

export const cateringSnapshots = () =>
  run(
    () =>
      client().GET("/api/admin/reports/catering/snapshots", {
        signal: AbortSignal.timeout(20_000),
      }),
    (v): v is CateringSnapshot[] =>
      Array.isArray(v) && v.every(snapshotResponse),
  );

type FreezeResult =
  | { kind: "ok"; data: CateringSnapshot }
  | { kind: "rejected" }
  | { kind: "version-conflict"; latestVersion: number }
  | { kind: "uncertain" };

export async function freezeCatering(
  body: FreezeCatering,
  csrf: string,
): Promise<FreezeResult> {
  try {
    const { response, data, error } = await client().POST(
      "/api/admin/reports/catering/snapshots",
      {
        body,
        headers: { "X-CSRF-Token": csrf },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.ok) {
      if (
        snapshotResponse(data) &&
        data.schemaVersion > 0 &&
        data.version === body.expectedVersion + 1 &&
        data.eventId === body.eventId &&
        data.includeArchived === body.includeArchived
      )
        return { kind: "ok", data };
      return { kind: "uncertain" };
    }
    const responseError = error as unknown;
    const code = errorCode(responseError);
    switch (response.status) {
      case 400:
        if (code === "VALIDATION_ERROR") return { kind: "rejected" };
        break;
      case 401:
        if (code === "UNAUTHENTICATED") return { kind: "rejected" };
        break;
      case 403:
        if (code === "FORBIDDEN" || code === "CSRF_INVALID")
          return { kind: "rejected" };
        break;
      case 409: {
        if (code !== "CATERING_SNAPSHOT_VERSION_CONFLICT") break;
        const details =
          obj(responseError) &&
          obj(responseError.error) &&
          responseError.error.details;
        const latestVersion = obj(details) ? details.latestVersion : undefined;
        if (
          typeof latestVersion === "number" &&
          Number.isSafeInteger(latestVersion) &&
          latestVersion > body.expectedVersion
        )
          return { kind: "version-conflict", latestVersion };
        break;
      }
    }
  } catch {
    // A transport or response parsing failure can occur after commit.
  }
  return { kind: "uncertain" };
}

export const cateringComparison = (version: number) =>
  run(
    () =>
      client().GET("/api/admin/reports/catering/snapshots/{version}", {
        params: { path: { version } },
        signal: AbortSignal.timeout(20_000),
      }),
    (v): v is CateringComparison =>
      obj(v) &&
      snapshotResponse(v.snapshot) &&
      time(v.generatedAt) &&
      isCateringTotals(v.frozen) &&
      isCateringTotals(v.live) &&
      Array.isArray(v.changes) &&
      v.changes.every(
        (row) =>
          obj(row) &&
          typeof row.invitationId === "string" &&
          typeof row.eventId === "string" &&
          nullableText(row.previousStatus) &&
          nullableText(row.currentStatus) &&
          count(row.frozenExpected) &&
          count(row.currentExpected) &&
          Number.isSafeInteger(row.netChange) &&
          Array.isArray(row.changes) &&
          row.changes.every((label) => typeof label === "string") &&
          Array.isArray(row.evidence) &&
          row.evidence.every((label) => typeof label === "string"),
      ),
  );
