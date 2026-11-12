import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "../../src/auth/server-session";
import { SESSION_ENDED_PATH } from "../../src/auth/auth-state";
import { SessionUnavailable } from "../../components/session-unavailable";
import { LogoutButton } from "../../components/logout-button";
import { ReceptionWorkspace } from "../../components/reception-workspace";
export default async function ReceptionPage() {
  const session = await getServerSession();
  if (session.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (session.kind !== "authenticated")
    return <SessionUnavailable forbidden={session.kind === "forbidden"} />;
  if (session.auth.user.mustChangePassword) redirect("/account/password");
  if (
    session.auth.user.role !== "OWNER" &&
    session.auth.user.role !== "GUEST_MANAGER"
  )
    redirect("/checkin");
  return (
    <main className="checkin-page reception-page">
      <header className="checkin-header">
        <div>
          <p className="eyebrow">HeyJo · Reception</p>
          <h1>Guest reception</h1>
          <p>Welcome each group and record only the guests arriving now.</p>
        </div>
        <div className="checkin-account">
          <p>{session.auth.user.email}</p>
          <nav aria-label="Operator account">
            {session.auth.user.role === "OWNER" ? (
              <Link href="/" prefetch={false}>
                Back to dashboard
              </Link>
            ) : null}
            <Link href="/account/password" prefetch={false}>
              Change password
            </Link>
            <LogoutButton csrfToken={session.auth.csrfToken} />
          </nav>
        </div>
      </header>
      <ReceptionWorkspace csrfToken={session.auth.csrfToken} />
    </main>
  );
}
