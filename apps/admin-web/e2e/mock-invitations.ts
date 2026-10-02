// Test-only contract server. Production routes always use the real API boundary.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  AdminInvitationListResponse,
  CreateAdminInvitationRequest,
} from "@wedding-invitation/api-client/src/index";
import { events, item } from "../tests/invitation-fixtures";
type Row = AdminInvitationListResponse["items"][number];
const created = new Map<string, Row[]>();
export async function mockInvitations(
  request: IncomingMessage,
  response: ServerResponse,
  session?: { email: string; csrf: string },
): Promise<boolean> {
  const url = new URL(request.url!, "http://localhost");
  if (!["/api/admin/invitations", "/api/admin/events"].includes(url.pathname))
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
  if (request.method === "GET") {
    if (session.email.startsWith("list-ended")) {
      fail(401, "UNAUTHENTICATED");
      return true;
    }
    if (session.email.startsWith("list-forbidden")) {
      fail(403, "FORBIDDEN");
      return true;
    }
    if (session.email.startsWith("list-error")) {
      fail(500, "INTERNAL_ERROR");
      return true;
    }
    if (session.email.startsWith("list-malformed")) {
      response.end("{}");
      return true;
    }
    if (session.email.startsWith("list-slow"))
      await new Promise((resolve) => setTimeout(resolve, 1200));
    if (url.pathname === "/api/admin/events") {
      response.end(
        JSON.stringify({
          events: session.email.startsWith("no-events") ? [] : events,
        }),
      );
      return true;
    }
    let rows: Row[] = session.email.startsWith("list-empty")
      ? []
      : Array.from({ length: 27 }, (_, index) => ({
          ...item,
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
          displayName: `Household ${String(index + 1).padStart(2, "0")}`,
          greetingName: `Greeting ${index + 1}`,
          status: index % 2 ? "ARCHIVED" : "ACTIVE",
          rsvpStatus: (["PENDING", "ACCEPTED", "DECLINED"] as const)[
            index % 3
          ]!,
          inviteeCount: index + 1,
          openCount: index + 3,
        }));
    rows = [...(created.get(session.email) ?? []), ...rows];
    for (const field of ["status", "rsvpStatus"] as const) {
      const value = url.searchParams.get(field);
      if (value) rows = rows.filter((row) => row[field] === value);
    }
    const search = url.searchParams.get("search")?.toLowerCase();
    if (search)
      rows = rows.filter(
        (row) =>
          row.displayName.toLowerCase().includes(search) ||
          row.greetingName?.toLowerCase().includes(search),
      );
    const sort = url.searchParams.get("sortBy"),
      order = url.searchParams.get("sortOrder") === "asc" ? 1 : -1;
    if (sort === "displayName")
      rows.sort((a, b) => order * a.displayName.localeCompare(b.displayName));
    const page = Number(url.searchParams.get("page") ?? 1),
      pageSize = Number(url.searchParams.get("pageSize") ?? 25),
      totalItems = rows.length;
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
  if (request.method === "POST" && url.pathname === "/api/admin/invitations") {
    if (
      request.headers.origin !== "http://localhost:3001" ||
      request.headers["x-csrf-token"] !== session.csrf
    ) {
      fail(403, "CSRF_INVALID");
      return true;
    }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw) as CreateAdminInvitationRequest;
    if (
      !body.displayName.trim() ||
      !body.eventIds.length ||
      !body.invitees.length
    ) {
      fail(400, "VALIDATION_ERROR");
      return true;
    }
    const row = {
      ...item,
      id: randomUUID(),
      displayName: body.displayName,
      greetingName: body.greetingName,
      inviteeCount: body.invitees.length,
      openCount: 0,
      rsvpStatus: "PENDING" as const,
      lastOpenedAt: null,
      rsvpDeadlineAt: body.rsvpDeadlineAt,
    };
    created.set(session.email, [row, ...(created.get(session.email) ?? [])]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        invitation: row,
        publicTokenVersion: 1,
        publicUrl: "http://localhost:3000/i/synthetic-create-only",
      }),
    );
    return true;
  }
  fail(405, "METHOD_NOT_ALLOWED");
  return true;
}
