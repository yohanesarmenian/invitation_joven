import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "../../../../src/auth/server-session";
import { SESSION_ENDED_PATH } from "../../../../src/auth/auth-state";
import { getEvents } from "../../../../src/invitations/server-invitations";
import { GuestImport } from "../../../../components/guest-import";
import { InvitationReadError } from "../../../../components/invitation-list";
export default async function ImportPage() {
  const session = await getServerSession();
  if (session.kind !== "authenticated") return null;
  const events = await getEvents();
  if (events.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (events.kind === "forbidden")
    return <InvitationReadError forbidden href="/invitations/import" />;
  return (
    <>
      <header className="dashboard-heading">
        <p className="eyebrow">Guest management</p>
        <h1>Import CSV/XLSX</h1>
        <p>Validate and review households before creating invitations.</p>
        <Link href="/invitations" prefetch={false}>
          Back to invitations
        </Link>
      </header>
      <GuestImport
        csrfToken={session.auth.csrfToken}
        eventSlugs={
          events.kind === "ready"
            ? events.data.events.filter((e) => e.isActive).map((e) => e.slug)
            : null
        }
      />
    </>
  );
}
