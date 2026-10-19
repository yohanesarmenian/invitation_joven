import Link from "next/link";
import { Suspense } from "react";
import { getServerSession } from "../../../../src/auth/server-session";
import { DetailContent } from "../../../../components/invitation-detail-content";

export default async function InvitationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (session.kind !== "authenticated") return null;
  const [{ id }, search] = await Promise.all([params, searchParams]);
  return (
    <>
      <header className="dashboard-heading invitation-heading">
        <div>
          <p className="eyebrow">Guest management</p>
          <h1>Invitation detail</h1>
          <p>Review safe operational state and lifecycle actions.</p>
        </div>
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </header>
      {search.updated === "1" && (
        <p className="notice" role="status">
          Invitation updated.
        </p>
      )}
      {search.archived === "1" && (
        <p className="notice" role="status">
          Invitation archived.
        </p>
      )}
      {search.inviteeCreated === "1" && (
        <p className="notice" role="status">
          Invitee added.
        </p>
      )}
      {search.inviteeUpdated === "1" && (
        <p className="notice" role="status">
          Invitee updated.
        </p>
      )}
      {search.inviteeDeleted === "1" && (
        <p className="notice" role="status">
          Invitee deleted.
        </p>
      )}
      {search.eventsUpdated === "1" && (
        <p className="notice" role="status">
          Event eligibility updated.
        </p>
      )}
      <Suspense fallback={<p role="status">Loading invitation detail...</p>}>
        <DetailContent csrfToken={session.auth.csrfToken} id={id} />
      </Suspense>
    </>
  );
}
