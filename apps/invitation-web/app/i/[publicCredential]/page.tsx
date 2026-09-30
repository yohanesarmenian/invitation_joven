import { notFound } from "next/navigation";
import { InvitationOpeningFlow } from "@/components/invitation/invitation-opening-flow";
import {
  PublicInvitationLongPage,
  type PublicInvitationLongPageModel,
} from "@/components/invitation/public-invitation-long-page";
import { retrievePublicInvitation } from "@/src/server/public-invitation";
import { retrievePublicRsvp, submitPublicRsvp } from "@/src/server/public-rsvp";
import { PublicRsvpForm } from "@/components/invitation/public-rsvp-form";
import { GuestMessageForm } from "@/components/invitation/guest-message-form";
import { submitPublicGuestMessage } from "@/src/server/public-guest-message";
import type {
  SubmitPublicRsvpRequest,
  SubmitPublicGuestMessageRequest,
} from "../../../../../packages/api-client/src/index";

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

  const initialRsvp = await retrievePublicRsvp(publicCredential);
  async function sendGuestMessage(request: SubmitPublicGuestMessageRequest) {
    "use server";
    return submitPublicGuestMessage(publicCredential, request);
  }
  async function reloadRsvp() {
    "use server";
    return retrievePublicRsvp(publicCredential);
  }
  async function submitRsvp(request: SubmitPublicRsvpRequest) {
    "use server";
    // Next encrypts the captured credential in the server action closure.
    // The API remains authoritative for every submitted field and version.
    return submitPublicRsvp(publicCredential, request);
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
      <PublicInvitationLongPage
        invitation={invitation}
        guestMessageForm={<GuestMessageForm submitAction={sendGuestMessage} />}
        rsvpForm={
          <PublicRsvpForm
            invitation={{
              invitees: result.data.invitation.invitees,
              rules: result.data.invitation.rules,
              events: result.data.invitation.events.map(({ id, name }) => ({
                id,
                name,
              })),
            }}
            initialResult={initialRsvp}
            submitAction={submitRsvp}
            reloadAction={reloadRsvp}
          />
        }
      />
    </InvitationOpeningFlow>
  );
}
