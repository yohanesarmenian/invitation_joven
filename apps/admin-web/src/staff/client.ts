"use client";
import {
  createInvitationApiClient,
  type AdminStaff,
  type AdminStaffListResponse,
  type AdminStaffProvisionResponse,
} from "@wedding-invitation/api-client/src/index";
import { currentSession } from "../auth/browser-client";
import { errorCode } from "../auth/auth-state";
import { isUuid } from "../invitations/contract";
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const integer = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const isStaff = (v: unknown): v is AdminStaff =>
  object(v) &&
  isUuid(v.id) &&
  typeof v.email === "string" &&
  (v.role === "CHECKIN_STAFF" || v.role === "GUEST_MANAGER") &&
  (v.status === "ACTIVE" || v.status === "DISABLED") &&
  typeof v.mustChangePassword === "boolean";
export const isStaffList = (v: unknown): v is AdminStaffListResponse =>
  object(v) &&
  Array.isArray(v.items) &&
  v.items.every(
    (item) =>
      object(item) &&
      date(item.createdAt) &&
      (item.lastLoginAt === null || date(item.lastLoginAt)) &&
      isStaff(item),
  ) &&
  object(v.page) &&
  integer(v.page.number) &&
  Number(v.page.number) > 0 &&
  integer(v.page.pageSize) &&
  Number(v.page.pageSize) > 0 &&
  integer(v.page.totalItems) &&
  integer(v.page.totalPages);
const isProvision = (v: unknown): v is AdminStaffProvisionResponse =>
  object(v) &&
  isStaff(v.staff) &&
  typeof v.temporaryPassword === "string" &&
  v.temporaryPassword.length >= 15 &&
  v.temporaryPassword.length <= 128;
export type StaffResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "error"; code: string; csrfToken?: string }
  | { kind: "uncertain" };
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
  mutation = false,
): Promise<StaffResult<T>> {
  try {
    const { data, error, response } = await request();
    if (response.ok && guard(data)) return { kind: "ok", data };
    if (response.status === 401)
      return { kind: "error", code: "UNAUTHENTICATED" };
    const code = errorCode(error);
    if (response.status === 403 && code === "CSRF_INVALID") {
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
    if ([400, 403, 404, 409].includes(response.status))
      return { kind: "error", code: code ?? "REJECTED" };
    return mutation
      ? { kind: "uncertain" }
      : { kind: "error", code: "NETWORK_ERROR" };
  } catch {
    return mutation
      ? { kind: "uncertain" }
      : { kind: "error", code: "NETWORK_ERROR" };
  }
}
const unsafe = (csrf: string) => ({
  headers: { "X-CSRF-Token": csrf },
  signal: AbortSignal.timeout(20_000),
});
export const listStaff = (
  page: number,
  status: "ACTIVE" | "DISABLED" | undefined,
) =>
  run(
    () =>
      client().GET("/api/admin/staff", {
        params: {
          query: { page, pageSize: 25, ...(status ? { status } : {}) },
        },
        signal: AbortSignal.timeout(20_000),
      }),
    isStaffList,
  );
export const createStaff = (
  email: string,
  csrf: string,
  role?: "GUEST_MANAGER" | "CHECKIN_STAFF",
) =>
  run(
    () =>
      client().POST("/api/admin/staff", {
        ...unsafe(csrf),
        body: { email, ...(role ? { role } : {}) },
      }),
    isProvision,
    true,
  );
export const changeStaffStatus = (
  staffId: string,
  status: "ACTIVE" | "DISABLED",
  csrf: string,
) =>
  run(
    () =>
      client().PATCH("/api/admin/staff/{staffId}", {
        ...unsafe(csrf),
        params: { path: { staffId } },
        body: { status },
      }),
    isStaff,
    true,
  );
export const resetStaff = (staffId: string, csrf: string) =>
  run(
    () =>
      client().POST("/api/admin/staff/{staffId}/reset-password", {
        ...unsafe(csrf),
        params: { path: { staffId } },
      }),
    isProvision,
    true,
  );
