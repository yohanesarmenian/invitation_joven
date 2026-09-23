import { notFound } from "next/navigation";
import { retrievePublicInvitation } from "@/src/server/public-invitation";

export const dynamic = "force-dynamic";

type PublicInvitationPageProps = {
  params: Promise<{
    publicCredential: string;
  }>;
};

export default async function PublicInvitationPage({
  params,
}: PublicInvitationPageProps) {
  const { publicCredential } = await params;
  const result = await retrievePublicInvitation(publicCredential);

  if (result.status === "unavailable") {
    notFound();
  }

  const guestName =
    result.data.invitation.greetingName ?? result.data.invitation.displayName;

  return (
    <main aria-labelledby="invitation-shell-title">
      <p>You are invited</p>
      <h1 id="invitation-shell-title">{guestName}</h1>
      <p>The full invitation experience will appear here soon.</p>
    </main>
  );
}
