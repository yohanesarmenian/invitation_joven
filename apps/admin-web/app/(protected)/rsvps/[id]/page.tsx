import Link from "next/link";
import { Suspense } from "react";
import { getServerSession } from "../../../../src/auth/server-session";
import { RsvpDetailContent } from "../../../../components/rsvp-detail-content";

export default async function RsvpDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ rsvpOverridden?: string }>;
}) {
  const session = await getServerSession();
  if (session.kind !== "authenticated") return null;
  const [{ id }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({ rsvpOverridden: undefined }),
  ]);
  return (
    <>
      <header className="dashboard-heading invitation-heading">
        <div>
          <p className="eyebrow">Guest management</p>
          <h1>RSVP detail</h1>
          <p>
            Review attendee snapshots, event selections, notes, and safe pass
            metadata.
          </p>
        </div>
        <Link href="/rsvps" prefetch={false}>
          Back to RSVPs
        </Link>
      </header>
      <Suspense fallback={<p role="status">Loading RSVP detail...</p>}>
        <RsvpDetailContent
          csrfToken={session.auth.csrfToken}
          id={id}
          showSaved={query.rsvpOverridden === "1"}
        />
      </Suspense>
    </>
  );
}
