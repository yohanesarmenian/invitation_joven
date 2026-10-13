import { redirect } from "next/navigation";
import { LogoutButton } from "../../components/logout-button";
import { SessionUnavailable } from "../../components/session-unavailable";
import { SESSION_ENDED_PATH } from "../../src/auth/auth-state";
import { getServerSession } from "../../src/auth/server-session";

export default async function CheckinPage() {
  const session = await getServerSession();

  if (session.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (session.kind !== "authenticated")
    return <SessionUnavailable forbidden={session.kind === "forbidden"} />;
  if (session.auth.user.mustChangePassword) redirect("/account/password");
  if (session.auth.user.role === "OWNER") redirect("/");

  return (
    <main className="admin-shell">
      <section className="dashboard-heading">
        <p className="eyebrow">Check-in</p>
        <h1>Check-in access</h1>
        <p>Scanner access is not available in this slice.</p>
      </section>
      <p>{session.auth.user.email}</p>
      <LogoutButton csrfToken={session.auth.csrfToken} />
    </main>
  );
}
