// Test-only contract server. Production routes always use the real API boundary.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  AdminInvitationDetailResponse,
  AdminInvitationListResponse,
  CreateAdminInviteeRequest,
  CreateAdminInvitationRequest,
  ReplaceAdminInvitationEventsRequest,
  UpdateAdminInviteeRequest,
  UpdateAdminInvitationRequest,
} from "@wedding-invitation/api-client/src/index";
import { detail, events, item } from "../tests/invitation-fixtures";
type Row = AdminInvitationListResponse["items"][number];
type Detail = AdminInvitationDetailResponse["invitation"];
const created = new Map<string, Row[]>();
const details = new Map<string, Detail>();
const publicVersions = new Map<string, number>();
const stateKey = (email: string, id: string) => `${email}:${id}`;

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
    const key = stateKey(email, row.id);
    if (!details.has(key)) {
      details.set(key, {
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
      publicVersions.set(key, 1);
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
          inviteeCount: next.invitees.length,
          lastOpenedAt: next.lastOpenedAt,
          rsvpDeadlineAt: next.rsvpDeadlineAt,
          updatedAt: next.updatedAt,
          archivedAt: next.archivedAt,
        }
      : row;
  created.set(email, (created.get(email) ?? []).map(update));
}
function inviteeMutation(invitationId: string, invitee: Detail["invitees"][number]) {
  return {
    ...invitee,
    invitationId,
    createdAt: invitee.updatedAt,
  };
}
async function readBody<T>(request: IncomingMessage): Promise<T> {
  let raw = "";
  for await (const chunk of request) raw += String(chunk);
  return JSON.parse(raw) as T;
}
function detailForInvitee(email: string, inviteeId: string) {
  const prefix = `${email}:`;
  for (const [key, current] of details) {
    if (!key.startsWith(prefix)) continue;
    const invitee = current.invitees.find((row) => row.id === inviteeId);
    if (invitee) return { current, invitee };
  }
  return null;
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
      ) ||
      /^\/api\/admin\/invitations\/[^/]+\/(invitees|events)$/.test(
        url.pathname,
      ) ||
      /^\/api\/admin\/invitees\/[^/]+$/.test(
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
      const current = id ? details.get(stateKey(session.email, id)) : undefined;
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
            publicTokenVersion:
              publicVersions.get(stateKey(session.email, current.id)) ?? 1,
            publicUrl: `http://localhost:3000/i/mock-${current.id}-${publicVersions.get(stateKey(session.email, current.id)) ?? 1}`,
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
    const body = await readBody<CreateAdminInvitationRequest>(request);
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
    details.set(stateKey(session.email, row.id), {
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
    publicVersions.set(stateKey(session.email, row.id), 1);
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
  if (parts[3] === "invitees") {
    const inviteeId = parts[4];
    const found = inviteeId ? detailForInvitee(session.email, inviteeId) : null;
    if (!found) {
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
    if (request.method === "PATCH") {
      const body = await readBody<UpdateAdminInviteeRequest>(request);
      if (body.expectedUpdatedAt !== found.invitee.updatedAt) {
        fail(409, "CONFLICT");
        return true;
      }
      if (body.fullName !== undefined && !body.fullName.trim()) {
        fail(400, "VALIDATION_ERROR");
        return true;
      }
      const updatedAt = new Date(
        Date.parse(found.invitee.updatedAt) + 1000,
      ).toISOString();
      const nextInvitee = {
        ...found.invitee,
        fullName: body.fullName ?? found.invitee.fullName,
        category: body.category ?? found.invitee.category,
        label: body.label === undefined ? found.invitee.label : body.label,
        updatedAt,
      };
      const next: Detail = {
        ...found.current,
        invitees: found.current.invitees.map((invitee) =>
          invitee.id === inviteeId ? nextInvitee : invitee,
        ),
        updatedAt,
      };
      details.set(stateKey(session.email, next.id), next);
      syncRow(session.email, next);
      response.end(JSON.stringify(inviteeMutation(next.id, nextInvitee)));
      return true;
    }
    if (request.method === "DELETE") {
      if (inviteeId === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") {
        fail(409, "CONFLICT");
        return true;
      }
      const updatedAt = new Date(
        Date.parse(found.current.updatedAt) + 1000,
      ).toISOString();
      const next: Detail = {
        ...found.current,
        invitees: found.current.invitees.filter(
          (invitee) => invitee.id !== inviteeId,
        ),
        updatedAt,
      };
      details.set(stateKey(session.email, next.id), next);
      syncRow(session.email, next);
      response.statusCode = 204;
      response.end();
      return true;
    }
    fail(405, "METHOD_NOT_ALLOWED");
    return true;
  }
  const id = parts[4];
  const action = parts[5];
  const current = id ? details.get(stateKey(session.email, id)) : undefined;
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
    const body = await readBody<UpdateAdminInvitationRequest>(request);
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
    details.set(stateKey(session.email, current.id), next);
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
    details.set(stateKey(session.email, current.id), next);
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
    const body = await readBody<{ expectedTokenVersion: number }>(request);
    const observed = publicVersions.get(stateKey(session.email, current.id)) ?? 1;
    if (body.expectedTokenVersion !== observed) {
      fail(409, "CONFLICT");
      return true;
    }
    const next = observed + 1;
    publicVersions.set(stateKey(session.email, current.id), next);
    const nextDetail = { ...current, publicTokenVersion: next };
    details.set(stateKey(session.email, current.id), nextDetail);
    response.end(
      JSON.stringify({
        publicTokenVersion: next,
        publicUrl: `http://localhost:3000/i/mock-${current.id}-${next}`,
      }),
    );
    return true;
  }
  if (request.method === "POST" && action === "invitees") {
    const body = await readBody<CreateAdminInviteeRequest>(request);
    if (
      !body.fullName.trim() ||
      (body.category !== "ADULT" && body.category !== "CHILD")
    ) {
      fail(400, "VALIDATION_ERROR");
      return true;
    }
    const updatedAt = new Date(Date.parse(current.updatedAt) + 1000).toISOString();
    const invitee = {
      id: randomUUID(),
      fullName: body.fullName.trim(),
      category: body.category,
      label: body.label ?? null,
      displayOrder:
        Math.max(0, ...current.invitees.map((row) => row.displayOrder)) + 1,
      updatedAt,
    };
    const next: Detail = {
      ...current,
      invitees: [...current.invitees, invitee],
      updatedAt,
    };
    details.set(stateKey(session.email, current.id), next);
    syncRow(session.email, next);
    response.statusCode = 201;
    response.end(JSON.stringify(inviteeMutation(current.id, invitee)));
    return true;
  }
  if (request.method === "PUT" && action === "events") {
    const body = await readBody<ReplaceAdminInvitationEventsRequest>(request);
    if (
      !Array.isArray(body.eventIds) ||
      body.eventIds.some((eventId) => !events.some((event) => event.id === eventId))
    ) {
      fail(400, "VALIDATION_ERROR");
      return true;
    }
    if (
      current.eligibility.some(({ event }) => event.id === events[0]!.id) &&
      !body.eventIds.includes(events[0]!.id)
    ) {
      fail(409, "CONFLICT");
      return true;
    }
    const eligibility = body.eventIds.map((eventId) => ({
      event: events.find((event) => event.id === eventId)!,
    }));
    const next: Detail = {
      ...current,
      eligibility,
      updatedAt: new Date(Date.parse(current.updatedAt) + 1000).toISOString(),
    };
    details.set(stateKey(session.email, current.id), next);
    syncRow(session.email, next);
    response.end(JSON.stringify({ eligibility }));
    return true;
  }
  fail(405, "METHOD_NOT_ALLOWED");
  return true;
}
