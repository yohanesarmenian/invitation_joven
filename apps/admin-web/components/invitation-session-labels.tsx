import type { AdminInvitationListResponse } from "@wedding-invitation/api-client/src/index";

type Session =
  AdminInvitationListResponse["items"][number]["eligibleEvents"][number];

export function InvitationSessionLabels({
  sessions,
  empty,
}: {
  sessions: Session[];
  empty: string;
}) {
  if (!sessions.length) return <span>{empty}</span>;
  return (
    <ul className="invitation-session-labels" aria-label="Sessions">
      {sessions.map((session) => (
        <li key={session.id}>
          {session.name}
          {!session.isActive && <span> · Inactive</span>}
        </li>
      ))}
    </ul>
  );
}
