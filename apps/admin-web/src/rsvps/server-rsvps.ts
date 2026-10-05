import "server-only";
import { cookies } from "next/headers";
import {
  createInvitationApiClient,
  type AdminEventsResponse,
  type AdminRsvpDetailResponse,
  type AdminRsvpListResponse,
} from "@wedding-invitation/api-client/src/index";
import { getAdminApiBaseUrl } from "../auth/api-config";
import {
  isAdminEvents,
  isRsvpDetail,
  isRsvpList,
  isUuid,
} from "./contract";
import { rsvpQueryString, type RsvpQuery } from "./query";

export type ReadResult<T> =
  | { kind: "ready"; data: T }
  | { kind: "unauthenticated" | "forbidden" | "not-found" | "unavailable" };

async function clientForRead(query?: RsvpQuery) {
  const name =
    process.env.NODE_ENV === "production"
      ? "__Host-admin_session"
      : "admin_session";
  const cookie = (await cookies()).get(name);
  const client = createInvitationApiClient({
    baseUrl: getAdminApiBaseUrl(),
    cache: "no-store",
    redirect: "error",
    headers: cookie ? { Cookie: `${name}=${cookie.value}` } : {},
  });
  if (query)
    client.use({
      onRequest({ request }) {
        const url = new URL(request.url);
        url.search = rsvpQueryString(query);
        return new Request(url, request);
      },
    });
  return client;
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

export async function getRsvpEvents(): Promise<
  ReadResult<AdminEventsResponse>
> {
  try {
    const { data, response } = await (
      await clientForRead()
    ).GET("/api/admin/events");
    const read = result(response.status, data, isAdminEvents);
    return read.kind === "ready"
      ? {
          kind: "ready",
          data: {
            events: read.data.events.map(
              ({ id, slug, name, isActive, displayOrder }) => ({
                id,
                slug,
                name,
                isActive,
                displayOrder,
              }),
            ),
          },
        }
      : read;
  } catch {
    return { kind: "unavailable" };
  }
}

export async function getRsvps(
  query: RsvpQuery,
): Promise<ReadResult<AdminRsvpListResponse>> {
  try {
    const { data, response } = await (
      await clientForRead(query)
    ).GET("/api/admin/rsvps");
    const read = result(response.status, data, isRsvpList);
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

export async function getRsvpDetail(
  rsvpId: string,
): Promise<ReadResult<AdminRsvpDetailResponse>> {
  if (!isUuid(rsvpId)) return { kind: "not-found" };
  try {
    const path =
      `/api/admin/rsvps/${encodeURIComponent(rsvpId)}` as "/api/admin/rsvps/{rsvpId}";
    const { data, response } = await (await clientForRead()).GET(path);
    return result(response.status, data, isRsvpDetail);
  } catch {
    return { kind: "unavailable" };
  }
}
