"use client";
import {
  createInvitationApiClient,
  type AdminAuthResponse,
  type AdminChangePasswordRequest,
  type AdminLoginRequest,
} from "@wedding-invitation/api-client/src/index";
import {
  errorCode,
  FORBIDDEN,
  loginFailure,
  readAuth,
  SESSION_ENDED,
  type SessionResult,
} from "./auth-state";

// No shared mutable auth state: credentials remain browser-managed HttpOnly cookies.
function client() {
  return createInvitationApiClient({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
}
export async function signIn(
  body: AdminLoginRequest,
): Promise<
  | { ok: true; auth: AdminAuthResponse }
  | { ok: false; message: string }
> {
  try {
    const { data, error, response } = await client().POST(
      "/api/admin/auth/login",
      { body },
    );
    const auth = response.status === 200 ? readAuth(data) : null;
    if (auth) return { ok: true, auth };
    return {
      ok: false,
      message: loginFailure(response.status, errorCode(error)),
    };
  } catch {
    return { ok: false, message: loginFailure(0) };
  }
}
export async function changeOwnPassword(
  csrfToken: string,
  body: AdminChangePasswordRequest,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { error, response } = await client().POST(
      "/api/admin/auth/change-password",
      {
        body,
        headers: { "X-CSRF-Token": csrfToken },
      },
    );
    if (response.status === 204) return { ok: true };
    if (response.status === 401 && errorCode(error) === "UNAUTHENTICATED")
      return { ok: false, message: SESSION_ENDED };
    if (response.status === 403)
      return {
        ok: false,
        message:
          errorCode(error) === "CSRF_INVALID"
            ? "Reload this page before trying again."
            : FORBIDDEN,
      };
    if (response.status === 400 || response.status === 401)
      return { ok: false, message: "Check both passwords and try again." };
    return { ok: false, message: "Unable to change password. Please try again." };
  } catch {
    return { ok: false, message: "Unable to change password. Please try again." };
  }
}
export async function currentSession(): Promise<SessionResult> {
  try {
    const { data, response } = await client().GET("/api/admin/auth/me");
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    const auth = response.status === 200 ? readAuth(data) : null;
    return auth ? { kind: "authenticated", auth } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}
export type LogoutResult =
  | { kind: "signed-out" | "session-ended" }
  | { kind: "retry"; csrfToken: string }
  | { kind: "failure"; message: string; reload?: boolean };
export async function signOut(csrfToken: string): Promise<LogoutResult> {
  try {
    const { error, response } = await client().POST("/api/admin/auth/logout", {
      headers: { "X-CSRF-Token": csrfToken },
    });
    if (response.status === 204) return { kind: "signed-out" };
    if (response.status === 401) return { kind: "session-ended" };
    if (response.status === 403 && errorCode(error) === "CSRF_INVALID") {
      // Exactly one fresh read; the next POST must come from another user action.
      const session = await currentSession();
      if (session.kind === "unauthenticated") return { kind: "session-ended" };
      if (session.kind === "authenticated")
        return { kind: "retry", csrfToken: session.auth.csrfToken };
      return {
        kind: "failure",
        message:
          session.kind === "forbidden"
            ? FORBIDDEN
            : "Unable to refresh your session. Reload this page before trying again.",
        reload: true,
      };
    }
    return {
      kind: "failure",
      message:
        response.status === 403
          ? FORBIDDEN
          : "Unable to sign out. Please try again.",
    };
  } catch {
    return {
      kind: "failure",
      message: "Unable to sign out. Please try again.",
    };
  }
}
