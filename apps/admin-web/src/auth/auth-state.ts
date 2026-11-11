import type {
  AdminAuthResponse,
  AdminLoginRequest,
} from "@wedding-invitation/api-client/src/index";

export const SESSION_ENDED =
  "Your admin session has ended. Please sign in again.";
export const SESSION_ENDED_PATH = "/login?session=ended";
export const AUTH_UNAVAILABLE =
  "Unable to verify your admin session. Please try again.";
export const FORBIDDEN = "You are not authorized to perform this action.";
export type SessionResult =
  | { kind: "authenticated"; auth: AdminAuthResponse }
  | { kind: "unauthenticated" | "forbidden" | "unavailable" };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
// Pick only the generated safe contract, never pass arbitrary upstream fields to React.
export function readAuth(value: unknown): AdminAuthResponse | null {
  if (
    !record(value) ||
    !record(value.user) ||
    !record(value.session) ||
    typeof value.user.id !== "string" ||
    typeof value.user.email !== "string" ||
    (value.user.role !== "OWNER" &&
      value.user.role !== "CHECKIN_STAFF" &&
      value.user.role !== "GUEST_MANAGER") ||
    typeof value.user.mustChangePassword !== "boolean" ||
    typeof value.session.expiresAt !== "string" ||
    typeof value.csrfToken !== "string"
  )
    return null;
  return {
    user: {
      id: value.user.id,
      email: value.user.email,
      mustChangePassword: value.user.mustChangePassword,
      role: value.user.role,
    },
    session: { expiresAt: value.session.expiresAt },
    csrfToken: value.csrfToken,
  };
}
export function errorCode(value: unknown): string | undefined {
  return record(value) &&
    record(value.error) &&
    typeof value.error.code === "string"
    ? value.error.code
    : undefined;
}
export function validateLogin(
  email: string,
  password: string,
): {
  fields: Partial<Record<"email" | "password", string>>;
  body: AdminLoginRequest;
} {
  const normalized = email.trim().toLowerCase();
  const fields: Partial<Record<"email" | "password", string>> = {};
  if (!normalized) fields.email = "Enter your email address.";
  else if (
    [...normalized].length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  )
    fields.email = "Enter a valid email address of at most 254 characters.";
  if (!password) fields.password = "Enter your password.";
  else if ([...password].length < 15 || [...password].length > 128)
    fields.password = "Use 15 to 128 characters, including spaces.";
  return { fields, body: { email: normalized, password } };
}
export function loginFailure(status: number, code?: string): string {
  if (status === 401 && code === "INVALID_CREDENTIALS")
    return "Email or password is incorrect.";
  if (status === 429 && code === "TOO_MANY_LOGIN_ATTEMPTS")
    return "Too many sign-in attempts. Please try again later.";
  if (status === 400 && code === "VALIDATION_ERROR")
    return "Check your email and password, then try again.";
  if (status === 403) return FORBIDDEN;
  return "Unable to sign in. Please try again.";
}
