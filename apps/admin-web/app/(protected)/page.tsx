import { getServerSession } from "../../src/auth/server-session";
import { Suspense } from "react";
import { DashboardContent } from "../../components/dashboard-content";
import { DashboardLoading } from "../../components/dashboard";

export default async function DashboardPage() {
  // Next may evaluate pages alongside layouts. Gate this payload too, before
  // producing any protected content for the server-component stream.
  if ((await getServerSession()).kind !== "authenticated") return null;
  return (
    <>
      <header className="dashboard-heading">
        <p className="eyebrow">Wedding overview</p>
        <h1>Dashboard</h1>
        <p>Overview of invitations and RSVP activity.</p>
      </header>
      <Suspense fallback={<DashboardLoading />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}
