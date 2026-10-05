import "server-only";
import { cookies } from "next/headers";
import {
  createInvitationApiClient,
  type AdminGuestMessageListResponse,
} from "@wedding-invitation/api-client/src/index";
import { getAdminApiBaseUrl } from "../auth/api-config";
import { isGuestMessageList } from "./contract";
import {
  isUuid,
  messageQueryString,
  type MessageQuery,
} from "./query";

export type ReadResult<T> =
  | { kind: "ready"; data: T }
  | { kind: "unauthenticated" | "forbidden" | "not-found" | "unavailable" };

async function clientForRead(query: MessageQuery, scopedPath: boolean) {
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
  client.use({
    onRequest({ request }) {
      const url = new URL(request.url);
      url.search = messageQueryString(query, { scopedPath });
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

export async function getGuestMessages(
  query: MessageQuery,
): Promise<ReadResult<AdminGuestMessageListResponse>> {
  if (query.invitationId && !isUuid(query.invitationId))
    return { kind: "not-found" };
  const scoped = Boolean(query.invitationId);
  try {
    const client = await clientForRead(query, scoped);
    const { data, response } = scoped
      ? await client.GET(
          `/api/admin/invitations/${encodeURIComponent(
            query.invitationId!,
          )}/messages` as "/api/admin/invitations/{invitationId}/messages",
        )
      : await client.GET("/api/admin/messages");
    const read = result(response.status, data, isGuestMessageList);
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
