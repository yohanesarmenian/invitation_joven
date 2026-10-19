import Link from "next/link";
import { redirect } from "next/navigation";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import {
  getEvents,
  getInvitationDetail,
} from "../src/invitations/server-invitations";
import { InvitationReadError } from "./invitation-list";
import { InvitationDetail } from "./invitation-detail";

export async function DetailContent({
  csrfToken,
  id,
}: {
  csrfToken: string;
  id: string;
}) {
  const [result, eventResult] = await Promise.all([
    getInvitationDetail(id),
    getEvents(),
  ]);
  if (result.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (eventResult.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
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
  if (eventResult.kind !== "ready")
    return (
      <InvitationReadError
        forbidden={eventResult.kind === "forbidden"}
        href={`/invitations/${id}`}
      />
    );
  return (
    <InvitationDetail
      csrfToken={csrfToken}
      events={eventResult.data.events}
      invitation={result.data.invitation}
    />
  );
}
