import { AUTH_UNAVAILABLE, FORBIDDEN } from "../src/auth/auth-state";
export function SessionUnavailable({ forbidden }: { forbidden: boolean }) {
  return (
    <main className="login-page">
      <section className="panel login-card">
        <h1>Admin access unavailable</h1>
        <p role="alert">{forbidden ? FORBIDDEN : AUTH_UNAVAILABLE}</p>
        <a href="/login">Return to sign in</a>
      </section>
    </main>
  );
}
