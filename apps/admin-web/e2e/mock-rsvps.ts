import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AdminRsvpDetailResponse,
  AdminRsvpListResponse,
} from "@wedding-invitation/api-client/src/index";
import {
  rsvpDetail,
  rsvpEvents,
  rsvpItem,
} from "../tests/rsvp-fixtures";

const detailState = new Map<string, AdminRsvpDetailResponse["rsvp"]>();
const csrfRejected = new Set<string>();
const overrideCounts = new Map<string, number>();
const lastDetailId = new Map<string, string>();
const invitationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function stateKey(email: string, id: string) {
  return `${email}:${id}`;
}

function detailFor(email: string, id: string) {
  const key = stateKey(email, id);
  lastDetailId.set(email, id);
  if (!detailState.has(key))
    detailState.set(key, {
      ...rsvpDetail.rsvp,
      id,
      invitation: {
        ...rsvpDetail.rsvp.invitation,
        id: invitationId,
        displayName: "RSVP Household 01",
      },
    });
  return detailState.get(key)!;
}

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
      /^\/api\/admin\/rsvps\/[^/]+$/.test(url.pathname) ||
      /^\/api\/admin\/invitations\/[^/]+\/rsvp$/.test(url.pathname)
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
  const mutationMatch = url.pathname.match(
    /^\/api\/admin\/invitations\/([^/]+)\/rsvp$/,
  );
  if (mutationMatch && request.method === "PUT") {
    const countKey = session.email;
    overrideCounts.set(countKey, (overrideCounts.get(countKey) ?? 0) + 1);
    if (
      session.email.startsWith("rsvp-csrf") &&
      !csrfRejected.has(session.email)
    ) {
      csrfRejected.add(session.email);
      session.csrf = "fresh-rsvp-csrf";
      fail(403, "CSRF_INVALID");
      return true;
    }
    if (request.headers["x-csrf-token"] !== session.csrf) {
      fail(403, "CSRF_INVALID");
      return true;
    }
    if (session.email.startsWith("rsvp-conflict")) {
      fail(409, "RSVP_VERSION_CONFLICT");
      return true;
    }
    if (session.email.startsWith("rsvp-uncertain")) {
      fail(500, "INTERNAL_ERROR");
      return true;
    }
    if (session.email.startsWith("rsvp-malformed-success")) {
      response.end("{}");
      return true;
    }
    const raw = await new Promise<string>((resolve) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => resolve(body));
    });
    const body = JSON.parse(raw) as {
      status: "ACCEPTED" | "DECLINED";
      overrideReason: string;
    };
    const current = detailFor(
      session.email,
      lastDetailId.get(session.email) ?? rsvpDetail.rsvp.id,
    );
    const next = {
      ...current,
      status: body.status,
      version: current.version + 1,
      updatedAt: "2026-10-02T18:00:00.000Z",
      submittedByAdmin: true,
      adminUser: {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        email: session.email,
      },
      overrideReason: body.overrideReason,
      checkinPasses:
        body.status === "ACCEPTED"
          ? current.checkinPasses
          : current.checkinPasses.map((pass) =>
              pass.status === "ACTIVE"
                ? {
                    ...pass,
                    status: "REVOKED" as const,
                    revokedAt: "2026-10-02T18:00:00.000Z",
                    revocationReason: "RSVP_DECLINED",
                  }
                : pass,
            ),
    };
    detailState.set(stateKey(session.email, current.id), next);
    response.end(JSON.stringify({ rsvp: next }));
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
    response.end(JSON.stringify({ rsvp: detailFor(session.email, id ?? rsvpDetail.rsvp.id) }));
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
