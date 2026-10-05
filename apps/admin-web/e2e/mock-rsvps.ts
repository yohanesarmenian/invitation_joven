import type { IncomingMessage, ServerResponse } from "node:http";
import type { AdminRsvpListResponse } from "@wedding-invitation/api-client/src/index";
import {
  rsvpDetail,
  rsvpEvents,
  rsvpItem,
} from "../tests/rsvp-fixtures";

function rowsFor(email: string): AdminRsvpListResponse["items"] {
  if (email.startsWith("rsvp-empty")) return [];
  return Array.from({ length: 12 }, (_, index) => ({
    ...rsvpItem,
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
    invitation: {
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
      displayName: `RSVP Household ${String(index + 1).padStart(2, "0")}`,
      status: index % 5 === 0 ? "ARCHIVED" : "ACTIVE",
    },
    status: (["PENDING", "ACCEPTED", "DECLINED"] as const)[index % 3]!,
    version: index + 1,
    attendeeCount: index % 3 === 2 ? 0 : index + 1,
    attendingEventCount: index % 3 === 1 ? 2 : index % 3 === 2 ? 0 : 1,
    submittedByAdmin: index % 4 === 0,
  }));
}

export async function mockRsvps(
  request: IncomingMessage,
  response: ServerResponse,
  session?: { email: string; csrf: string },
): Promise<boolean> {
  const url = new URL(request.url!, "http://localhost");
  if (
    !(
      url.pathname === "/api/admin/rsvps" ||
      /^\/api\/admin\/rsvps\/[^/]+$/.test(url.pathname)
    )
  )
    return false;

  const fail = (status: number, code: string) => {
    response.statusCode = status;
    response.end(
      JSON.stringify({
        error: { code, message: "Private diagnostic", details: null },
      }),
    );
  };
  if (!session) {
    fail(401, "UNAUTHENTICATED");
    return true;
  }
  if (request.method !== "GET") {
    fail(405, "METHOD_NOT_ALLOWED");
    return true;
  }
  if (session.email.startsWith("rsvp-ended")) {
    fail(401, "UNAUTHENTICATED");
    return true;
  }
  if (session.email.startsWith("rsvp-forbidden")) {
    fail(403, "FORBIDDEN");
    return true;
  }
  if (session.email.startsWith("rsvp-error")) {
    fail(500, "INTERNAL_ERROR");
    return true;
  }
  if (session.email.startsWith("rsvp-malformed")) {
    response.end("{}");
    return true;
  }
  if (session.email.startsWith("rsvp-slow"))
    await new Promise((resolve) => setTimeout(resolve, 1200));

  if (url.pathname !== "/api/admin/rsvps") {
    const id = url.pathname.split("/").at(-1);
    if (id === "00000000-0000-4000-8000-000000000000") {
      fail(404, "NOT_FOUND");
      return true;
    }
    response.end(
      JSON.stringify({
        rsvp: {
          ...rsvpDetail.rsvp,
          id: id ?? rsvpDetail.rsvp.id,
          invitation: {
            ...rsvpDetail.rsvp.invitation,
            displayName: "RSVP Household 01",
          },
        },
      }),
    );
    return true;
  }

  let rows = rowsFor(session.email);
  const status = url.searchParams.get("status");
  if (status) rows = rows.filter((row) => row.status === status);
  const eventId = url.searchParams.get("eventId");
  if (eventId === rsvpEvents[1]!.id)
    rows = rows.filter((row) => row.attendingEventCount > 1);
  const search = url.searchParams.get("search")?.toLowerCase();
  if (search)
    rows = rows.filter((row) =>
      row.invitation.displayName.toLowerCase().includes(search),
    );
  const sort = url.searchParams.get("sortBy");
  const order = url.searchParams.get("sortOrder") === "asc" ? 1 : -1;
  if (sort === "status")
    rows.sort((a, b) => order * a.status.localeCompare(b.status));

  const page = Number(url.searchParams.get("page") ?? 1);
  const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
  const totalItems = rows.length;
  response.end(
    JSON.stringify({
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      page: {
        number: page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    }),
  );
  return true;
}
