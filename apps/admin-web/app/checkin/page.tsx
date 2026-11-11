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
  if (session.auth.user.role === "GUEST_MANAGER") redirect("/reception");

  return (
    <main className="checkin-page">
      <header className="checkin-header">
        <div>
          <p className="eyebrow">HeyJo · Venue operations</p>
          <h1>Check-in</h1>
          <p className="hint">
            Welcome guests and confirm each household once.
          </p>
        </div>
        <div className="checkin-account">
          <p>{session.auth.user.email}</p>
          <nav aria-label="Operator account">
            {session.auth.user.role === "OWNER" && (
              <Link href="/" prefetch={false}>
                Back to dashboard
              </Link>
            )}
            {session.auth.user.role === "OWNER" ? (
              <Link href="/reception" prefetch={false}>
                Open guest reception
              </Link>
            ) : null}
            <Link href="/account/password" prefetch={false}>
              Change password
            </Link>
            <LogoutButton csrfToken={session.auth.csrfToken} />
          </nav>
        </div>
      </header>
      <CheckinWorkspace csrfToken={session.auth.csrfToken} />
    </main>
  );
}
