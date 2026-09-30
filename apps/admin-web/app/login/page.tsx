import { redirect } from "next/navigation";
import { getServerSession } from "../../src/auth/server-session";
import { AUTH_UNAVAILABLE, FORBIDDEN } from "../../src/auth/auth-state";
import { LoginForm } from "../../components/login-form";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const session = await getServerSession();
  if (session.kind === "authenticated") redirect("/");
  const query = await searchParams;
  return (
    <main className="login-page">
      <section className="panel login-card" aria-labelledby="login-title">
        <p className="eyebrow">Wedding Invitation Admin</p>
        <h1 id="login-title">Sign in</h1>
        <p>Use your OWNER account to continue.</p>
        <LoginForm
          sessionEnded={query.session === "ended"}
          initialNotice={
            session.kind === "unavailable"
              ? AUTH_UNAVAILABLE
              : session.kind === "forbidden"
                ? FORBIDDEN
                : undefined
          }
        />
      </section>
    </main>
  );
}
