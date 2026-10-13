import { redirect } from "next/navigation";
import { getServerSession } from "../../src/auth/server-session";
import { SESSION_ENDED_PATH } from "../../src/auth/auth-state";
import { AdminShell } from "../../components/admin-shell";
import { SessionUnavailable } from "../../components/session-unavailable";
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (session.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (session.kind !== "authenticated")
    return <SessionUnavailable forbidden={session.kind === "forbidden"} />;
  if (session.auth.user.mustChangePassword) redirect("/account/password");
  if (session.auth.user.role === "CHECKIN_STAFF") redirect("/checkin");
  return (
    <AdminShell
      email={session.auth.user.email}
      csrfToken={session.auth.csrfToken}
    >
      {children}
    </AdminShell>
  );
}
