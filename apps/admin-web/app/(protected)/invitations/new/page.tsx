import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "../../../../src/auth/server-session";
import { getEvents } from "../../../../src/invitations/server-invitations";
import { SESSION_ENDED_PATH } from "../../../../src/auth/auth-state";
import { InvitationReadError } from "../../../../components/invitation-list";
import { CreateInvitationForm } from "../../../../components/create-invitation-form";
async function CreateContent({ csrfToken }: { csrfToken: string }) {
  const result = await getEvents();
  if (result.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (result.kind !== "ready")
    return (
      <InvitationReadError
        forbidden={result.kind === "forbidden"}
        href="/invitations/new"
      />
    );
  return (
    <CreateInvitationForm events={result.data.events} csrfToken={csrfToken} />
  );
}
export default async function NewInvitationPage() {
  const session = await getServerSession();
  if (session.kind !== "authenticated") return null;
  return (
    <>
      <header className="dashboard-heading">
        <p className="eyebrow">Invitations / A personal welcome</p>
        <h1>Create invitation</h1>
        <p>
          Add your guests, review the details, then share their personal link.
        </p>
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </header>
      <Suspense fallback={<p role="status">Loading wedding event…</p>}>
        <CreateContent csrfToken={session.auth.csrfToken} />
      </Suspense>
    </>
  );
}
