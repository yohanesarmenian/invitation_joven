import "server-only";
import { cookies } from "next/headers";
import {
  createInvitationApiClient,
  type AdminDashboardResponse,
} from "@wedding-invitation/api-client/src/index";
import { getAdminApiBaseUrl } from "../auth/api-config";

export type DashboardResult =
  | { kind: "ready"; data: AdminDashboardResponse }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function isDashboard(value: unknown): value is AdminDashboardResponse {
  if (
    !object(value) ||
    !object(value.invitations) ||
    !object(value.rsvp) ||
    !Array.isArray(value.expectedByEvent)
  )
    return false;
  const { invitations, rsvp } = value;
  return (
    [
      invitations.active,
      invitations.archived,
      invitations.openedActive,
      rsvp.pending,
      rsvp.accepted,
      rsvp.declined,
    ].every(count) &&
    value.expectedByEvent.every(
      (row) =>
        object(row) &&
        object(row.event) &&
        typeof row.event.id === "string" &&
        typeof row.event.slug === "string" &&
        typeof row.event.name === "string" &&
        count(row.expectedAttendeeCount),
    )
  );
}

export async function getDashboard(): Promise<DashboardResult> {
  try {
    const name =
      process.env.NODE_ENV === "production"
        ? "__Host-admin_session"
        : "admin_session";
    const cookie = (await cookies()).get(name);
    const client = createInvitationApiClient({ baseUrl: getAdminApiBaseUrl() });
    const { data, response } = await client.GET("/api/admin/dashboard", {
      cache: "no-store",
      redirect: "error",
      headers: cookie ? { Cookie: `${name}=${cookie.value}` } : {},
    });
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    return response.status === 200 && isDashboard(data)
      ? { kind: "ready", data }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
