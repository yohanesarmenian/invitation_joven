import { getServerSession } from "../../src/auth/server-session";
import { Suspense } from "react";
import { DashboardContent } from "../../components/dashboard-content";
import { DashboardLoading } from "../../components/dashboard";
import Link from "next/link";

export default async function DashboardPage() {
  // Next may evaluate pages alongside layouts. Gate this payload too, before
  // producing any protected content for the server-component stream.
  if ((await getServerSession()).kind !== "authenticated") return null;
  return (
    <>
      <header className="dashboard-heading">
        <div className="dashboard-heading-copy">
          <p className="eyebrow">Your wedding, at a glance</p>
          <h1>Dashboard</h1>
          <p>Every invitation, every response, one beautiful day.</p>
        </div>
        <Link
          className="invitation-primary dashboard-primary"
          href="/invitations/new"
          prefetch={false}
        >
          Create invitation
        </Link>
      </header>
      <Suspense fallback={<DashboardLoading />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}
