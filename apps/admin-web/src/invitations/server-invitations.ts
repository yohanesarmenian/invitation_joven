import "server-only";
import { cookies } from "next/headers";
import {
  createInvitationApiClient,
  type AdminEventsResponse,
  type AdminInvitationDetailResponse,
  type AdminInvitationListResponse,
} from "@wedding-invitation/api-client/src/index";
import { getAdminApiBaseUrl } from "../auth/api-config";
import { isEvent, isEvents, isInvitationDetail, isUuid } from "./contract";
import type { InvitationQuery } from "./query";
import { isInvitationOrigin } from "./create-workflow";

export type ReadResult<T> =
  | { kind: "ready"; data: T }
  | { kind: "unauthenticated" | "forbidden" | "not-found" | "unavailable" };
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
function isOverview(v: unknown) {
  if (!object(v) || !object(v.rsvp) || !Array.isArray(v.events)) return false;
  return (
    count(v.households) &&
    count(v.namedGuests) &&
    count(v.opened) &&
    count(v.unopened) &&
    v.opened + v.unopened === v.households &&
    count(v.rsvp.pending) &&
    count(v.rsvp.accepted) &&
    count(v.rsvp.declined) &&
    v.rsvp.pending + v.rsvp.accepted + v.rsvp.declined === v.households &&
    v.events.every(
      (event) =>
        object(event) &&
        count(event.eligibleHouseholds) &&
        count(v.households) &&
        event.eligibleHouseholds <= v.households &&
        isEvent(event),
    )
  );
}
export function isInvitationList(v: unknown): v is AdminInvitationListResponse {
  if (
    !object(v) ||
    !Array.isArray(v.items) ||
    !object(v.page) ||
    !isOverview(v.overview) ||
    (v.publicInvitationOrigin !== null &&
      !isInvitationOrigin(v.publicInvitationOrigin))
  )
    return false;
  const p = v.page;
  return (
    count(p.number) &&
    p.number >= 1 &&
    count(p.pageSize) &&
    p.pageSize >= 1 &&
    p.pageSize <= 100 &&
    count(p.totalItems) &&
    count(p.totalPages) &&
    p.totalPages === Math.ceil(p.totalItems / p.pageSize) &&
    v.items.length <= p.pageSize &&
    v.items.every(
      (row) =>
        object(row) &&
        isUuid(row.id) &&
        Array.isArray(row.eligibleEvents) &&
        row.eligibleEvents.every(isEvent) &&
        typeof row.displayName === "string" &&
        (row.greetingName === null || typeof row.greetingName === "string") &&
        (row.status === "ACTIVE" || row.status === "ARCHIVED") &&
        (row.rsvpStatus === "PENDING" ||
          row.rsvpStatus === "ACCEPTED" ||
          row.rsvpStatus === "DECLINED") &&
        count(row.inviteeCount) &&
        count(row.openCount) &&
        date(row.createdAt) &&
        date(row.updatedAt) &&
        nullableDate(row.archivedAt) &&
        nullableDate(row.rsvpDeadlineAt) &&
        nullableDate(row.lastOpenedAt),
    )
  );
}
async function clientForRead() {
  const name =
    process.env.NODE_ENV === "production"
      ? "__Host-admin_session"
      : "admin_session";
  const cookie = (await cookies()).get(name);
  return createInvitationApiClient({
    baseUrl: getAdminApiBaseUrl(),
    cache: "no-store",
    redirect: "error",
    headers: cookie ? { Cookie: `${name}=${cookie.value}` } : {},
  });
}
function result<T>(
  status: number,
  data: unknown,
  guard: (value: unknown) => value is T,
): ReadResult<T> {
  if (status === 401) return { kind: "unauthenticated" };
  if (status === 403) return { kind: "forbidden" };
  if (status === 404) return { kind: "not-found" };
  return status === 200 && guard(data)
    ? { kind: "ready", data }
    : { kind: "unavailable" };
}
export async function getInvitations(
  query: InvitationQuery,
): Promise<ReadResult<AdminInvitationListResponse>> {
  try {
    const { data, response } = await (
      await clientForRead()
    ).GET("/api/admin/invitations", { params: { query } });
    const read = result(response.status, data, isInvitationList);
    if (
      read.kind === "ready" &&
      (read.data.page.number !== query.page ||
        read.data.page.pageSize !== query.pageSize)
    )
      return { kind: "unavailable" };
    return read;
  } catch {
    return { kind: "unavailable" };
  }
}
export async function getEvents(): Promise<ReadResult<AdminEventsResponse>> {
  try {
    const { data, response } = await (
      await clientForRead()
    ).GET("/api/admin/events");
    const read = result(response.status, data, isEvents);
    // Explicit projection keeps any unexpected response properties server-only.
    return read.kind === "ready"
      ? {
          kind: "ready",
          data: {
            events: read.data.events.map(
              ({
                id,
                slug,
                name,
                isActive,
                displayOrder,
                startsAt,
                endsAt,
                venueName,
                address,
              }) => ({
                id,
                slug,
                name,
                isActive,
                displayOrder,
                ...(startsAt !== undefined ? { startsAt } : {}),
                ...(endsAt !== undefined ? { endsAt } : {}),
                ...(venueName !== undefined ? { venueName } : {}),
                ...(address !== undefined ? { address } : {}),
              }),
            ),
          },
        }
      : read;
  } catch {
    return { kind: "unavailable" };
  }
}
export async function getInvitationDetail(
  invitationId: string,
): Promise<ReadResult<AdminInvitationDetailResponse>> {
  if (!isUuid(invitationId)) return { kind: "not-found" };
  try {
    const path =
      `/api/admin/invitations/${encodeURIComponent(invitationId)}` as "/api/admin/invitations/{invitationId}";
    const { data, response } = await (await clientForRead()).GET(path);
    return result(response.status, data, isInvitationDetail);
  } catch {
    return { kind: "unavailable" };
  }
}
