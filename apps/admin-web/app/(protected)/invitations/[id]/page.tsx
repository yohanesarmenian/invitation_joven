import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "../../../../src/auth/server-session";
import { SESSION_ENDED_PATH } from "../../../../src/auth/auth-state";
import { getInvitationDetail } from "../../../../src/invitations/server-invitations";
import { InvitationReadError } from "../../../../components/invitation-list";
import { InvitationDetail } from "../../../../components/invitation-detail";

export async function DetailContent({
  csrfToken,
  id,
}: {
  csrfToken: string;
  id: string;
}) {
  const result = await getInvitationDetail(id);
  if (result.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (result.kind === "not-found")
    return (
      <section className="dashboard-error" role="alert">
        <h2>Invitation not found</h2>
        <p>This invitation could not be found.</p>
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </section>
    );
  if (result.kind !== "ready")
    return (
      <InvitationReadError
        forbidden={result.kind === "forbidden"}
        href={`/invitations/${id}`}
      />
    );
  return (
    <InvitationDetail
      csrfToken={csrfToken}
      invitation={result.data.invitation}
    />
  );
}

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
      <Suspense fallback={<p role="status">Loading invitation detail...</p>}>
        <DetailContent csrfToken={session.auth.csrfToken} id={id} />
      </Suspense>
    </>
  );
}
