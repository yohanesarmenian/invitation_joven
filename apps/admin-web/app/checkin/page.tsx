import { redirect } from "next/navigation";
import { LogoutButton } from "../../components/logout-button";
import { SessionUnavailable } from "../../components/session-unavailable";
import { SESSION_ENDED_PATH } from "../../src/auth/auth-state";
import { getServerSession } from "../../src/auth/server-session";
import Link from "next/link";
import { CheckinWorkspace } from "../../components/checkin-workspace";

export default async function CheckinPage() {
  const session = await getServerSession();

  if (session.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (session.kind !== "authenticated")
    return <SessionUnavailable forbidden={session.kind === "forbidden"} />;
  if (session.auth.user.mustChangePassword) redirect("/account/password");

  return (
    <main className="admin-shell">
      <section className="dashboard-heading">
        <p className="eyebrow">Check-in</p>
        <h1>Check-in</h1>
      </section>
      <p>{session.auth.user.email}</p>
      {session.auth.user.role === "OWNER" && (
        <Link href="/" prefetch={false}>
          Back to dashboard
        </Link>
      )}
      <Link href="/account/password" prefetch={false}>
        Change password
      </Link>
      <LogoutButton csrfToken={session.auth.csrfToken} />
      <CheckinWorkspace csrfToken={session.auth.csrfToken} />
    </main>
  );
}
