// Test-only contract server. Production routes always use the real API boundary.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  AdminInvitationDetailResponse,
  AdminInvitationListResponse,
  CreateAdminInvitationRequest,
  UpdateAdminInvitationRequest,
} from "@wedding-invitation/api-client/src/index";
import { detail, events, item } from "../tests/invitation-fixtures";
type Row = AdminInvitationListResponse["items"][number];
type Detail = AdminInvitationDetailResponse["invitation"];
const created = new Map<string, Row[]>();
const details = new Map<string, Detail>();
const publicVersions = new Map<string, number>();

function cloneDetail(row: Detail): Detail {
  return JSON.parse(JSON.stringify(row)) as Detail;
}
function rowsFor(email: string) {
  const baseRows = Array.from({ length: 27 }, (_, index) => ({
    ...item,
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
    displayName: `Household ${String(index + 1).padStart(2, "0")}`,
    greetingName: `Greeting ${index + 1}`,
    status: index % 2 ? ("ARCHIVED" as const) : ("ACTIVE" as const),
    rsvpStatus: (["PENDING", "ACCEPTED", "DECLINED"] as const)[index % 3]!,
    inviteeCount: index + 1,
    openCount: index + 3,
  }));
  const rows = [...(created.get(email) ?? []), ...baseRows];
  for (const row of rows) {
    if (!details.has(row.id)) {
      details.set(row.id, {
        ...cloneDetail(detail.invitation),
        id: row.id,
        displayName: row.displayName,
        greetingName: row.greetingName,
        status: row.status,
        openCount: row.openCount,
        lastOpenedAt: row.lastOpenedAt,
        rsvpDeadlineAt: row.rsvpDeadlineAt,
        archivedAt: row.archivedAt,
      });
      publicVersions.set(row.id, 1);
    }
  }
  return rows;
}
function syncRow(email: string, next: Detail) {
  const update = (row: Row): Row =>
    row.id === next.id
      ? {
          ...row,
          displayName: next.displayName,
          greetingName: next.greetingName,
          status: next.status,
          openCount: next.openCount,
          lastOpenedAt: next.lastOpenedAt,
          rsvpDeadlineAt: next.rsvpDeadlineAt,
          updatedAt: next.updatedAt,
          archivedAt: next.archivedAt,
        }
      : row;
  created.set(email, (created.get(email) ?? []).map(update));
}

export async function mockInvitations(
  request: IncomingMessage,
  response: ServerResponse,
  session?: { email: string; csrf: string },
): Promise<boolean> {
  const url = new URL(request.url!, "http://localhost");
  if (
    !(
      ["/api/admin/invitations", "/api/admin/events"].includes(url.pathname) ||
      /^\/api\/admin\/invitations\/[^/]+(\/(archive|public-url|regenerate-token))?$/.test(
        url.pathname,
      )
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
    if (url.pathname !== "/api/admin/invitations") {
      const parts = url.pathname.split("/");
      const id = parts[4];
      const action = parts[5];
      const current = id ? details.get(id) : undefined;
      if (!current) {
        fail(404, "NOT_FOUND");
        return true;
      }
      if (!action) {
        response.end(JSON.stringify({ invitation: current }));
        return true;
      }
      if (action === "public-url") {
        if (current.status === "ARCHIVED") {
          fail(409, "CONFLICT");
          return true;
        }
        response.end(
          JSON.stringify({
            publicTokenVersion: publicVersions.get(current.id) ?? 1,
            publicUrl: `http://localhost:3000/i/mock-${current.id}-${publicVersions.get(current.id) ?? 1}`,
          }),
        );
        return true;
      }
    }
    let rows: Row[] = session.email.startsWith("list-empty")
      ? []
      : rowsFor(session.email);
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
    details.set(row.id, {
      ...cloneDetail(detail.invitation),
      id: row.id,
      displayName: row.displayName,
      greetingName: row.greetingName,
      allowPlusOne: body.allowPlusOne,
      maxAdditionalChildren: body.maxAdditionalChildren,
      rsvpDeadlineAt: body.rsvpDeadlineAt,
      notes: body.notes,
      publicTokenVersion: 1,
      openCount: 0,
      firstOpenedAt: null,
      lastOpenedAt: null,
      updatedAt: row.updatedAt,
      archivedAt: null,
      invitees: body.invitees.map((invitee, index) => ({
        id: randomUUID(),
        fullName: invitee.fullName,
        category: invitee.category,
        label: invitee.label ?? null,
        displayOrder: index + 1,
        updatedAt: row.updatedAt,
      })),
      eligibility: body.eventIds.map((eventId) => ({
        event: events.find((event) => event.id === eventId) ?? events[0]!,
      })),
      rsvp: null,
      messages: { total: 0, hidden: 0 },
      checkinPasses: [],
    });
    publicVersions.set(row.id, 1);
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
  const parts = url.pathname.split("/");
  const id = parts[4];
  const action = parts[5];
  const current = id ? details.get(id) : undefined;
  if (!current) {
    fail(404, "NOT_FOUND");
    return true;
  }
  if (
    request.headers.origin !== "http://localhost:3001" ||
    request.headers["x-csrf-token"] !== session.csrf
  ) {
    fail(403, "CSRF_INVALID");
    return true;
  }
  if (request.method === "PATCH" && !action) {
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw) as UpdateAdminInvitationRequest;
    if (current.status === "ARCHIVED") {
      fail(409, "CONFLICT");
      return true;
    }
    if (body.expectedUpdatedAt !== current.updatedAt) {
      fail(409, "CONFLICT");
      return true;
    }
    if (body.displayName !== undefined && !body.displayName.trim()) {
      fail(400, "VALIDATION_ERROR");
      return true;
    }
    const updatedAt = new Date(
      Date.parse(current.updatedAt) + 1000,
    ).toISOString();
    const next: Detail = {
      ...current,
      displayName: body.displayName ?? current.displayName,
      greetingName:
        body.greetingName === undefined
          ? current.greetingName
          : body.greetingName,
      allowPlusOne: body.allowPlusOne ?? current.allowPlusOne,
      maxAdditionalChildren:
        body.maxAdditionalChildren ?? current.maxAdditionalChildren,
      rsvpDeadlineAt:
        body.rsvpDeadlineAt === undefined
          ? current.rsvpDeadlineAt
          : body.rsvpDeadlineAt,
      notes: body.notes === undefined ? current.notes : body.notes,
      updatedAt,
    };
    details.set(current.id, next);
    syncRow(session.email, next);
    response.end(JSON.stringify({ invitation: next }));
    return true;
  }
  if (request.method === "POST" && action === "archive") {
    const archivedAt = current.archivedAt ?? "2026-10-01T18:00:00.000Z";
    const next: Detail = {
      ...current,
      status: "ARCHIVED",
      archivedAt,
      updatedAt: "2026-10-01T18:00:01.000Z",
    };
    details.set(current.id, next);
    syncRow(session.email, next);
    response.end(
      JSON.stringify({
        invitation: { id: next.id, status: next.status, archivedAt },
      }),
    );
    return true;
  }
  if (request.method === "POST" && action === "regenerate-token") {
    if (current.status === "ARCHIVED") {
      fail(409, "CONFLICT");
      return true;
    }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw) as { expectedTokenVersion: number };
    const observed = publicVersions.get(current.id) ?? 1;
    if (body.expectedTokenVersion !== observed) {
      fail(409, "CONFLICT");
      return true;
    }
    const next = observed + 1;
    publicVersions.set(current.id, next);
    const nextDetail = { ...current, publicTokenVersion: next };
    details.set(current.id, nextDetail);
    response.end(
      JSON.stringify({
        publicTokenVersion: next,
        publicUrl: `http://localhost:3000/i/mock-${current.id}-${next}`,
      }),
    );
    return true;
  }
  fail(405, "METHOD_NOT_ALLOWED");
  return true;
}
