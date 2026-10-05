import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AdminGuestMessageListResponse,
  UpdateAdminGuestMessageResponse,
} from "@wedding-invitation/api-client/src/index";
import { hiddenMessageItem, messageItem } from "../tests/message-fixtures";

const csrfRejected = new Set<string>();
const state = new Map<string, AdminGuestMessageListResponse["items"]>();

function rowsFor(email: string) {
  if (email.startsWith("message-empty")) return [];
  if (!state.has(email))
    state.set(
      email,
      Array.from({ length: 12 }, (_, index) => {
        const scoped = index < 3;
        return {
          ...(index % 3 === 0 ? hiddenMessageItem : messageItem),
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
          invitation: {
            id: scoped
              ? messageItem.invitation.id
              : `bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(
                  12,
                  "0",
                )}`,
            displayName: scoped
              ? "Sample household"
              : `Message Household ${String(index + 1).padStart(2, "0")}`,
          },
          authorName:
            index % 4 === 1 ? null : `Message Guest ${String(index + 1)}`,
          message:
            index === 0
              ? "Congratulations from <script>window.__xss = true</script>"
              : `Message body ${index + 1}`,
          createdAt: new Date(
            Date.UTC(2026, 9, 1, 1, index, 0),
          ).toISOString(),
          isHidden: index % 3 === 0,
        };
      }),
    );
  return state.get(email)!;
}

function body(request: IncomingMessage) {
  return new Promise<string>((resolve) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => resolve(raw));
  });
}

function pageRows(rows: AdminGuestMessageListResponse["items"], url: URL) {
  const page = Number(url.searchParams.get("page") ?? 1);
  const pageSize = Number(url.searchParams.get("pageSize") ?? 25);
  const totalItems = rows.length;
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    page: {
      number: page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    },
  };
}

export async function mockMessages(
  request: IncomingMessage,
  response: ServerResponse,
  session?: { email: string; csrf: string },
): Promise<boolean> {
  const url = new URL(request.url!, "http://localhost");
  const scopedMatch = url.pathname.match(
    /^\/api\/admin\/invitations\/([^/]+)\/messages$/,
  );
  const mutationMatch = url.pathname.match(/^\/api\/admin\/messages\/([^/]+)$/);
  if (
    !(
      url.pathname === "/api/admin/messages" ||
      scopedMatch ||
      mutationMatch
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

  if (mutationMatch && request.method === "PATCH") {
    if (
      session.email.startsWith("message-csrf") &&
      !csrfRejected.has(session.email)
    ) {
      csrfRejected.add(session.email);
      session.csrf = "fresh-message-csrf";
      fail(403, "CSRF_INVALID");
      return true;
    }
    if (request.headers["x-csrf-token"] !== session.csrf) {
      fail(403, "CSRF_INVALID");
      return true;
    }
    if (session.email.startsWith("message-uncertain")) {
      fail(500, "INTERNAL_ERROR");
      return true;
    }
    const raw = await body(request);
    const parsed = JSON.parse(raw) as { isHidden?: unknown };
    if (typeof parsed.isHidden !== "boolean" || Object.keys(parsed).length !== 1) {
      fail(400, "VALIDATION_ERROR");
      return true;
    }
    const rows = rowsFor(session.email);
    const message = rows.find((row) => row.id === decodeURIComponent(mutationMatch[1]!));
    if (!message) {
      fail(404, "NOT_FOUND");
      return true;
    }
    const next: UpdateAdminGuestMessageResponse = {
      ...message,
      isHidden: parsed.isHidden,
    };
    rows[rows.indexOf(message)] = next;
    response.end(JSON.stringify(next));
    return true;
  }

  if (request.method !== "GET") {
    fail(405, "METHOD_NOT_ALLOWED");
    return true;
  }
  if (session.email.startsWith("message-ended")) {
    fail(401, "UNAUTHENTICATED");
    return true;
  }
  if (session.email.startsWith("message-forbidden")) {
    fail(403, "FORBIDDEN");
    return true;
  }
  if (session.email.startsWith("message-error")) {
    fail(500, "INTERNAL_ERROR");
    return true;
  }
  if (session.email.startsWith("message-malformed")) {
    response.end("{}");
    return true;
  }
  if (scopedMatch?.[1] === "00000000-0000-4000-8000-000000000000") {
    fail(404, "NOT_FOUND");
    return true;
  }

  let rows = rowsFor(session.email);
  const scopedInvitationId =
    scopedMatch?.[1] ?? url.searchParams.get("invitationId") ?? undefined;
  if (scopedInvitationId)
    rows = rows.filter((row) => row.invitation.id === scopedInvitationId);
  const hidden = url.searchParams.get("hidden") ?? "all";
  if (hidden === "visible") rows = rows.filter((row) => !row.isHidden);
  if (hidden === "hidden") rows = rows.filter((row) => row.isHidden);
  const order = url.searchParams.get("sortOrder") === "asc" ? 1 : -1;
  rows = [...rows].sort(
    (a, b) => order * a.createdAt.localeCompare(b.createdAt),
  );
  response.end(JSON.stringify(pageRows(rows, url)));
  return true;
}
