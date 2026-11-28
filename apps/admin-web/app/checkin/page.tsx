import { redirect } from "next/navigation";
import { LogoutButton } from "../../components/logout-button";
import { SessionUnavailable } from "../../components/session-unavailable";
import { SESSION_ENDED_PATH } from "../../src/auth/auth-state";
import { getServerSession } from "../../src/auth/server-session";
import Link from "next/link";

export default async function CheckinPage() {
  const session = await getServerSession();

  if (session.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (session.kind !== "authenticated")
    return <SessionUnavailable forbidden={session.kind === "forbidden"} />;
  if (session.auth.user.mustChangePassword) redirect("/account/password");
  if (session.auth.user.role === "OWNER") redirect("/");

  return (
    <main className="checkin-page">
      <header className="checkin-header">
        <div>
          <h1>Digital attendance is closed</h1>
          <p>Guests show their invitation and sign the physical guestbook.</p>
        </div>
        <nav className="checkin-account" aria-label="Operator account">
          <p>{session.auth.user.email}</p>
          <Link href="/account/password" prefetch={false}>
            Change password
          </Link>
          <LogoutButton csrfToken={session.auth.csrfToken} />
        </nav>
      </header>
    </main>
  );
}
