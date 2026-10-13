import { redirect } from "next/navigation";
import { PasswordChangeForm } from "../../../components/password-change-form";
import { SessionUnavailable } from "../../../components/session-unavailable";
import { SESSION_ENDED_PATH } from "../../../src/auth/auth-state";
import { getServerSession } from "../../../src/auth/server-session";

export default async function PasswordPage() {
  const session = await getServerSession();

  if (session.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (session.kind !== "authenticated")
    return <SessionUnavailable forbidden={session.kind === "forbidden"} />;

  return (
    <main className="admin-shell">
      <section className="dashboard-heading">
        <p className="eyebrow">Account security</p>
        <h1>Change password</h1>
      </section>
      <PasswordChangeForm auth={session.auth} />
    </main>
  );
}
