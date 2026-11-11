import type { IncomingMessage, ServerResponse } from "node:http";
const staff = new Map<
  string,
  {
    id: string;
    email: string;
    role: "CHECKIN_STAFF" | "GUEST_MANAGER";
    status: "ACTIVE" | "DISABLED";
    mustChangePassword: boolean;
    createdAt: string;
    lastLoginAt: null;
  }
>();
export async function mockStaff(
  request: IncomingMessage,
  response: ServerResponse,
  session?: {
    email: string;
    csrf: string;
    role: string;
    mustChangePassword: boolean;
  },
) {
  if (!request.url?.startsWith("/api/admin/staff")) return false;
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
  if (session.role !== "OWNER" || session.mustChangePassword) {
    fail(403, "FORBIDDEN");
    return true;
  }
  if (request.method === "GET") {
    response.end(
      JSON.stringify({
        items: [...staff.values()],
        page: {
          number: 1,
          pageSize: 25,
          totalItems: staff.size,
          totalPages: staff.size ? 1 : 0,
        },
      }),
    );
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
  const body = raw ? JSON.parse(raw) : {};
  if (request.url === "/api/admin/staff") {
    if ([...staff.values()].some((item) => item.email === body.email)) {
      fail(409, "CONFLICT");
      return true;
    }
    const id = `11111111-1111-4111-8111-${String(staff.size + 1).padStart(12, "0")}`;
    const item = {
      id,
      email: body.email,
      role: (body.role === "GUEST_MANAGER"
        ? "GUEST_MANAGER"
        : "CHECKIN_STAFF") as "GUEST_MANAGER" | "CHECKIN_STAFF",
      status: "ACTIVE" as const,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    staff.set(id, item);
    if (body.email.includes("lost-response")) {
      response.destroy();
      return true;
    }
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        staff: item,
        temporaryPassword: "synthetic temporary password",
      }),
    );
    return true;
  }
  const id = request.url.split("/")[4] ?? "",
    item = staff.get(id);
  if (!item) {
    fail(404, "NOT_FOUND");
    return true;
  }
  if (request.method === "PATCH") {
    item.status = body.status;
    response.end(JSON.stringify(item));
    return true;
  }
  item.mustChangePassword = true;
  response.end(
    JSON.stringify({
      staff: item,
      temporaryPassword: "synthetic replacement password",
    }),
  );
  return true;
}
