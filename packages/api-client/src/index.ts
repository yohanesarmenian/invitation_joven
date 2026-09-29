import createClient from "openapi-fetch";
import type { components, paths } from "./generated/schema.js";

export type ApiPaths = paths;
export type ApiComponents = components;
export type PublicInvitationResponse =
  components["schemas"]["PublicInvitationResponseDto"];
export type SubmitPublicRsvpRequest =
  components["schemas"]["SubmitPublicRsvpRequestDto"];
export type PublicRsvpMutationResponse =
  components["schemas"]["PublicRsvpMutationResponseDto"];
export type PublicRsvpReadResponse =
  components["schemas"]["PublicRsvpReadResponseDto"];
export type ApiErrorEnvelope = components["schemas"]["ApiErrorEnvelopeDto"];
export type GetPublicInvitationResponse =
  paths["/api/public/invitations/{publicCredential}"]["get"]["responses"]["200"]["content"]["application/json"];
export type SubmitPublicRsvpResponse =
  paths["/api/public/invitations/{publicCredential}/rsvp"]["put"]["responses"]["200"]["content"]["application/json"];
export type GetPublicRsvpResponse =
  paths["/api/public/invitations/{publicCredential}/rsvp"]["get"]["responses"]["200"]["content"]["application/json"];

export function createInvitationApiClient(
  options?: Parameters<typeof createClient<paths>>[0],
) {
  return createClient<paths>(options);
}

export type InvitationApiClient = ReturnType<typeof createInvitationApiClient>;
