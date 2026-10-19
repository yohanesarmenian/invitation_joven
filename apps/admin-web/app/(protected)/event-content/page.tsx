import { redirect } from "next/navigation";
import { getServerSession } from "../../../src/auth/server-session";
import { SESSION_ENDED_PATH } from "../../../src/auth/auth-state";
import { SessionUnavailable } from "../../../components/session-unavailable";
import { EventContentWorkspace } from "../../../components/event-content-workspace";
export default async function EventContentPage() {
  const session = await getServerSession();
  if (session.kind === "unauthenticated") redirect(SESSION_ENDED_PATH);
  if (session.kind !== "authenticated")
    return <SessionUnavailable forbidden={session.kind === "forbidden"} />;
  if (session.auth.user.mustChangePassword) redirect("/account/password");
  if (session.auth.user.role !== "OWNER") redirect("/checkin");
  return (
    <>
      <h1>Event materials</h1>
      <EventContentWorkspace csrfToken={session.auth.csrfToken} />
    </>
  );
}
