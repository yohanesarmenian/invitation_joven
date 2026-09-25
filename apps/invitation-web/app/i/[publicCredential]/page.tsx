import { notFound } from "next/navigation";
import { InvitationOpeningFlow } from "@/components/invitation/invitation-opening-flow";
import {
  PublicInvitationLongPage,
  type PublicInvitationLongPageModel,
} from "@/components/invitation/public-invitation-long-page";
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

  const invitation: PublicInvitationLongPageModel = {
    displayName: result.data.invitation.displayName,
    events: result.data.invitation.events.map((event) => ({
      address: event.address,
      googleMapsUrl: event.googleMapsUrl,
      name: event.name,
      startsAt: event.startsAt,
      venueName: event.venueName,
    })),
    greetingName: result.data.invitation.greetingName,
    rsvpDeadlineAt: result.data.invitation.rsvpDeadlineAt,
  };

  return (
    <InvitationOpeningFlow>
      <PublicInvitationLongPage invitation={invitation} />
    </InvitationOpeningFlow>
  );
}
