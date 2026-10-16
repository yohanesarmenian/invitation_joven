// Isolated test server for the locked auth and implemented admin operations.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mockInvitations } from "./mock-invitations";
import { mockMessages } from "./mock-messages";
import { mockRsvps } from "./mock-rsvps";
import { mockImports } from "./mock-imports";
import { mockCheckin } from "./mock-checkin";
import { mockStaff } from "./mock-staff";
import type { AdminAuthResponse } from "@wedding-invitation/api-client/src/index";
type TestSession = {
  email: string;
  csrf: string;
  rejected: boolean;
  role: AdminAuthResponse["user"]["role"];
  mustChangePassword: boolean;
};
const sessions = new Map<string, TestSession>();
const origin = "http://localhost:3001";
createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  function fail(status: number, code: string) {
    response.statusCode = status;
    response.end(
      JSON.stringify({
        error: { code, message: "Private backend diagnostic", details: null },
      }),
    );
  }
  function profile(
    email: string,
  ): Pick<TestSession, "role" | "mustChangePassword"> {
    if (email === "staff@example.com")
      return { role: "CHECKIN_STAFF", mustChangePassword: false };
    if (email === "staff-change@example.com")
      return { role: "CHECKIN_STAFF", mustChangePassword: true };
    if (email === "owner-change@example.com")
      return { role: "OWNER", mustChangePassword: true };
    return { role: "OWNER", mustChangePassword: false };
  }
  function safeAuth(session: TestSession): AdminAuthResponse {
    return {
      user: {
        id:
          session.role === "CHECKIN_STAFF"
            ? "synthetic-checkin-staff"
            : "synthetic-owner",
        email: session.email,
        mustChangePassword: session.mustChangePassword,
        role: session.role,
      },
      session: { expiresAt: new Date(Date.now() + 43_200_000).toISOString() },
      csrfToken: session.csrf,
    };
  }
  if (request.url === "/api/admin/auth/login" && request.method === "POST") {
    if (request.headers.origin !== origin) {
      fail(403, "CSRF_INVALID");
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw) as { email: string; password: string };
    if (
      body.email !== body.email.trim().toLowerCase() ||
      [...body.password].length < 15 ||
      [...body.password].length > 128
    ) {
      fail(400, "VALIDATION_ERROR");
      return;
    }
    if (
      [
        "unknown@example.com",
        "disabled@example.com",
        "wrong@example.com",
      ].includes(body.email)
    ) {
      fail(401, "INVALID_CREDENTIALS");
      return;
    }
    if (body.email === "throttled@example.com") {
      fail(429, "TOO_MANY_LOGIN_ATTEMPTS");
      return;
    }
    if (body.email === "validation@example.com") {
      fail(400, "VALIDATION_ERROR");
      return;
    }
    if (body.email === "unexpected@example.com") {
      fail(500, "INTERNAL_ERROR");
      return;
    }
    const session = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    const state: TestSession = {
      email: body.email,
      csrf,
      rejected: false,
      ...profile(body.email),
    };
    sessions.set(session, state);
    response.setHeader(
      "Set-Cookie",
      `admin_session=${session}; HttpOnly; SameSite=Strict; Path=/; Expires=${new Date(Date.now() + 43_200_000).toUTCString()}`,
    );
    response.end(JSON.stringify(safeAuth(state)));
    return;
  }
  const cookie = request.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("admin_session="))
    ?.slice("admin_session=".length);
  const session = cookie ? sessions.get(cookie) : undefined;
  if (await mockCheckin(request, response, session)) return;
  if (await mockStaff(request, response, session)) return;
  if (await mockImports(request, response, session)) return;
  if (await mockMessages(request, response, session)) {
    if (session?.email.startsWith("message-ended") && cookie)
      sessions.delete(cookie);
    return;
  }
  if (await mockRsvps(request, response, session)) {
    if (session?.email.startsWith("rsvp-ended") && cookie)
      sessions.delete(cookie);
    return;
  }
  if (await mockInvitations(request, response, session)) {
    if (session?.email.startsWith("list-ended") && cookie)
      sessions.delete(cookie);
    return;
  }
  if (request.url === "/api/admin/dashboard" && request.method === "GET") {
    if (!session) {
      fail(401, "UNAUTHENTICATED");
      return;
    }
    if (session.email === "dashboard-ended@example.com") {
      sessions.delete(cookie!);
      fail(401, "UNAUTHENTICATED");
      return;
    }
    if (session.email === "dashboard-forbidden@example.com") {
      fail(403, "FORBIDDEN");
      return;
    }
    if (session.email === "dashboard-error@example.com") {
      fail(500, "INTERNAL_ERROR");
      return;
    }
    if (session.email === "dashboard-malformed@example.com") {
      response.end(JSON.stringify({ invitations: {} }));
      return;
    }
    if (session.email === "dashboard-slow@example.com")
      await new Promise((resolve) => setTimeout(resolve, 1800));
    const empty = session.email === "dashboard-empty@example.com";
    response.end(
      JSON.stringify({
        invitations: {
          active: empty ? 0 : 7,
          archived: empty ? 0 : 2,
          openedActive: empty ? 0 : 5,
        },
        rsvp: {
          pending: empty ? 0 : 3,
          accepted: empty ? 0 : 9,
          declined: empty ? 0 : 4,
        },
        expectedByEvent: empty
          ? []
          : [
              {
                event: {
                  id: "event-1",
                  slug: "ceremony",
                  name: "Wedding ceremony",
                },
                expectedAttendeeCount: 11,
              },
              {
                event: { id: "event-2", slug: "reception", name: "Reception" },
                expectedAttendeeCount: 6,
              },
            ],
      }),
    );
    return;
  }
  if (request.url === "/api/admin/auth/me" && request.method === "GET") {
    if (!session) {
      fail(401, "UNAUTHENTICATED");
      return;
    }
    response.end(
      JSON.stringify(
        session.email === "malformed@example.com"
          ? { user: {} }
          : safeAuth(session),
      ),
    );
    return;
  }
  if (
    request.url === "/api/admin/auth/change-password" &&
    request.method === "POST"
  ) {
    if (!session) {
      fail(401, "UNAUTHENTICATED");
      return;
    }
    if (
      request.headers.origin !== origin ||
      request.headers["x-csrf-token"] !== session.csrf
    ) {
      fail(403, "CSRF_INVALID");
      return;
    }
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw) as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (
      typeof body.currentPassword !== "string" ||
      typeof body.newPassword !== "string" ||
      [...body.currentPassword].length < 15 ||
      [...body.newPassword].length < 15
    ) {
      fail(400, "VALIDATION_ERROR");
      return;
    }
    session.mustChangePassword = false;
    session.csrf = randomBytes(32).toString("base64url");
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.url === "/api/admin/auth/logout" && request.method === "POST") {
    if (!session) {
      fail(401, "UNAUTHENTICATED");
      return;
    }
    if (session.email === "ended@example.com") {
      sessions.delete(cookie!);
      fail(401, "UNAUTHENTICATED");
      return;
    }
    if (session.email === "forbidden@example.com") {
      fail(403, "FORBIDDEN");
      return;
    }
    if (session.email === "csrf@example.com" && !session.rejected) {
      session.rejected = true;
      session.csrf = randomBytes(32).toString("base64url");
      fail(403, "CSRF_INVALID");
      return;
    }
    if (
      request.headers.origin !== origin ||
      request.headers["x-csrf-token"] !== session.csrf
    ) {
      fail(403, "CSRF_INVALID");
      return;
    }
    sessions.delete(cookie!);
    response.setHeader(
      "Set-Cookie",
      "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
    response.statusCode = 204;
    response.end();
    return;
  }
  fail(404, "NOT_FOUND");
}).listen(4011, "127.0.0.1");
