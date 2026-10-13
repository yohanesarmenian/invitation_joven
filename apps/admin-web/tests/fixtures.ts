import type { AdminAuthResponse } from "@wedding-invitation/api-client/src/index";
export const auth: AdminAuthResponse = {
  user: {
    id: "synthetic-owner",
    email: "owner@example.com",
    mustChangePassword: false,
    role: "OWNER",
  },
  session: { expiresAt: "2030-01-01T00:00:00.000Z" },
  csrfToken: "synthetic-csrf",
};
export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
export function failure(code: string, status: number) {
  return json(
    { error: { code, message: "Private backend diagnostic", details: null } },
    status,
  );
}
