import { getServerSession } from "../../src/auth/server-session";

export default async function DashboardPage() {
  // Next may evaluate pages alongside layouts. Gate this payload too, before
  // producing any protected content for the server-component stream.
  if ((await getServerSession()).kind !== "authenticated") return null;
  return (
    <section className="panel">
      <p className="eyebrow">Admin foundation</p>
      <h1>Dashboard</h1>
      <p>
        You are signed in. Invitation management and reporting will be available
        in a later release.
      </p>
    </section>
  );
}
