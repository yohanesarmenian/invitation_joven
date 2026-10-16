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
