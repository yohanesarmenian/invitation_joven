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
  if (!result.data.events.some((event) => event.isActive))
    return (
      <section className="dashboard-error">
        <h2>No active events available</h2>
        <p>
          An invitation needs at least one active event. Try again after the
          event catalog is available.
        </p>
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </section>
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
        <p className="eyebrow">Guest management</p>
        <h1>New invitation</h1>
        <p>
          Create a household invitation with its guests and eligible events.
        </p>
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </header>
      <Suspense fallback={<p role="status">Loading event options…</p>}>
        <CreateContent csrfToken={session.auth.csrfToken} />
      </Suspense>
    </>
  );
}
