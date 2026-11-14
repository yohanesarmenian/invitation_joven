import Link from "next/link";
import { redirect } from "next/navigation";
import { SESSION_ENDED_PATH } from "../src/auth/auth-state";
import { getRsvpDetail } from "../src/rsvps/server-rsvps";
import { getInvitationDetail } from "../src/invitations/server-invitations";
import { RsvpReadError } from "./rsvp-list";
import { RsvpDetail } from "./rsvp-detail";
import { ActionFeedback } from "./action-feedback";

export async function RsvpDetailContent({
  csrfToken,
  id,
  showSaved = false,
}: {
  csrfToken: string;
  id: string;
  showSaved?: boolean;
}) {
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
  const invitation = await getInvitationDetail(result.data.rsvp.invitation.id);
  return (
    <>
      {showSaved &&
      result.data.rsvp.submittedByAdmin &&
      result.data.history.some((entry) => entry.action === "OWNER_OVERRIDE") ? (
        <ActionFeedback tone="success">
          RSVP updated successfully. Saved attendance and history are shown
          below.
        </ActionFeedback>
      ) : null}
      <RsvpDetail
        csrfToken={csrfToken}
        invitation={
          invitation.kind === "ready" ? invitation.data.invitation : undefined
        }
        history={result.data.history}
        rsvp={result.data.rsvp}
      />
    </>
  );
}
