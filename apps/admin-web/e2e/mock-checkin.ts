import type { IncomingMessage, ServerResponse } from "node:http";
const eventId = "11111111-1111-4111-8111-111111111111";
const invitationId = "22222222-2222-4222-8222-222222222222";
const recorded = new Map<
  string,
  { attendeeCount: number; checkedInAt: string; method: string }
>();
export async function mockCheckin(
  request: IncomingMessage,
  response: ServerResponse,
  session?: {
    email: string;
    csrf: string;
    role: string;
    mustChangePassword: boolean;
  },
) {
  if (!request.url?.startsWith("/api/admin/checkin/")) return false;
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
  if (session.mustChangePassword) {
    fail(403, "FORBIDDEN");
    return true;
  }
  const url = new URL(request.url, "http://mock"),
    path = url.pathname.split("/").at(-1);
  if (path === "events") {
    response.end(
      JSON.stringify({
        events: [
          { id: eventId, name: "Reception", slug: "reception", startsAt: null },
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "Ceremony",
            slug: "ceremony",
            startsAt: null,
          },
        ],
      }),
    );
    return true;
  }
  const key = session.email,
    previousCheckin = recorded.get(key) ?? null;
  const candidate = {
    invitation: { id: invitationId, displayName: "Scanner Household" },
    event: { id: eventId, name: "Reception" },
    expectedAttendeeCount: 3,
    alreadyCheckedIn: previousCheckin !== null,
  };
  if (path === "search") {
    response.end(JSON.stringify({ items: [candidate] }));
    return true;
  }
  if (
    request.headers.origin !== "http://localhost:3001" ||
    request.headers["x-csrf-token"] !== session.csrf
  ) {
    fail(403, "CSRF_INVALID");
    return true;
  }
  let raw = "";
  for await (const chunk of request) raw += String(chunk);
  const body = JSON.parse(raw);
  if (path === "manual-status") {
    response.end(
      JSON.stringify({
        status: previousCheckin ? "ALREADY_CONFIRMED" : "NOT_CONFIRMED",
        alreadyCheckedIn: !!previousCheckin,
        previousCheckin,
      }),
    );
    return true;
  }
  if (body.eventId !== eventId) {
    fail(422, "EVENT_NOT_SELECTED");
    return true;
  }
  if (body.qrPayload?.startsWith("z")) {
    fail(422, "QR_REVOKED");
    return true;
  }
  if (path === "validate") {
    response.end(
      JSON.stringify({
        ...candidate,
        status: previousCheckin ? "ALREADY_CONFIRMED" : "VALID",
        previousCheckin,
      }),
    );
    return true;
  }
  if (previousCheckin) {
    fail(409, "CHECKIN_ALREADY_CONFIRMED");
    return true;
  }
  const record = {
    attendeeCount: body.attendeeCount,
    checkedInAt: new Date().toISOString(),
    method: path === "manual-confirm" ? "MANUAL" : "QR",
  };
  recorded.set(key, record);
  if (session.email.includes("lost-response")) {
    response.destroy();
    return true;
  }
  response.statusCode = 201;
  response.end(
    JSON.stringify({
      checkinRecord: {
        ...record,
        id: invitationId,
        confirmedBy: {
          id: invitationId,
          email: session.email,
          role: session.role,
        },
      },
    }),
  );
  return true;
}
