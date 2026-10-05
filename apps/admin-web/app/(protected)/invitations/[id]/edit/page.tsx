import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "../../../../../src/auth/server-session";
import { SESSION_ENDED_PATH } from "../../../../../src/auth/auth-state";
import { getInvitationDetail } from "../../../../../src/invitations/server-invitations";
import { InvitationReadError } from "../../../../../components/invitation-list";
import { EditInvitationForm } from "../../../../../components/edit-invitation-form";

async function EditContent({
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
        href={`/invitations/${id}/edit`}
      />
    );
  if (result.data.invitation.status === "ARCHIVED")
    return (
      <section className="dashboard-error" role="alert">
        <h2>Archived invitation</h2>
        <p>Archived invitations cannot be edited.</p>
        <Link href={`/invitations/${id}`} prefetch={false}>
          Back to detail
        </Link>
      </section>
    );
  return (
    <EditInvitationForm
      csrfToken={csrfToken}
      invitation={result.data.invitation}
    />
  );
}

export default async function EditInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession();
  if (session.kind !== "authenticated") return null;
  const { id } = await params;
  return (
    <>
      <header className="dashboard-heading">
        <p className="eyebrow">Guest management</p>
        <h1>Edit invitation</h1>
        <p>Update fields using the version loaded with this form.</p>
        <Link href={`/invitations/${id}`} prefetch={false}>
          Back to detail
        </Link>
      </header>
      <Suspense fallback={<p role="status">Loading invitation edit form...</p>}>
        <EditContent csrfToken={session.auth.csrfToken} id={id} />
      </Suspense>
    </>
  );
}
