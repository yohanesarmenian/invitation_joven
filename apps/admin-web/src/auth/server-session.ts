import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createInvitationApiClient } from "@wedding-invitation/api-client/src/index";
import { getAdminApiBaseUrl } from "./api-config";
import { readAuth, type SessionResult } from "./auth-state";

// React cache is scoped to this server render, never shared between requests.
export const getServerSession = cache(async (): Promise<SessionResult> => {
  try {
    const cookieName =
      process.env.NODE_ENV === "production"
        ? "__Host-admin_session"
        : "admin_session";
    const cookie = (await cookies()).get(cookieName);
    const client = createInvitationApiClient({ baseUrl: getAdminApiBaseUrl() });
    const { data, response } = await client.GET("/api/admin/auth/me", {
      cache: "no-store",
      redirect: "error",
      headers: cookie ? { Cookie: `${cookieName}=${cookie.value}` } : {},
    });
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    const auth = response.status === 200 ? readAuth(data) : null;
    return auth ? { kind: "authenticated", auth } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
});
