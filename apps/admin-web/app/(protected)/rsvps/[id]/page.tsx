import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "../../../../src/auth/server-session";
import { SESSION_ENDED_PATH } from "../../../../src/auth/auth-state";
import { getRsvpDetail } from "../../../../src/rsvps/server-rsvps";
import { RsvpReadError } from "../../../../components/rsvp-list";
import { RsvpDetail } from "../../../../components/rsvp-detail";

export async function RsvpDetailContent({ id }: { id: string }) {
  const result = await getRsvpDetail(id);
  if (result.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (result.kind === "not-found")
    return (
      <section className="dashboard-error" role="alert">
        <h2>RSVP not found</h2>
        <p>This RSVP could not be found.</p>
        <Link href="/rsvps" prefetch={false}>
          Back to RSVPs
        </Link>
      </section>
    );
  if (result.kind !== "ready")
    return (
      <RsvpReadError
        forbidden={result.kind === "forbidden"}
        href={`/rsvps/${id}`}
      />
    );
  return <RsvpDetail rsvp={result.data.rsvp} />;
}

export default async function RsvpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (session.kind !== "authenticated") return null;
  const { id } = await params;
  return (
    <>
      <header className="dashboard-heading invitation-heading">
        <div>
          <p className="eyebrow">Guest management</p>
          <h1>RSVP detail</h1>
          <p>Review attendee snapshots, event selections, notes, and safe pass metadata.</p>
        </div>
        <Link href="/rsvps" prefetch={false}>
          Back to RSVPs
        </Link>
      </header>
      <Suspense fallback={<p role="status">Loading RSVP detail...</p>}>
        <RsvpDetailContent id={id} />
      </Suspense>
    </>
  );
}
