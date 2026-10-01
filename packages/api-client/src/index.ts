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
export type SubmitPublicGuestMessageRequest =
  components["schemas"]["SubmitPublicGuestMessageRequestDto"];
export type SubmitPublicGuestMessageResponse =
  components["schemas"]["PublicGuestMessageResponseDto"];
export type AdminLoginRequest =
  components["schemas"]["AdminLoginRequestDto"];
export type AdminAuthResponse =
  components["schemas"]["AdminAuthResponseDto"];
export type AdminDashboardResponse =
  components["schemas"]["AdminDashboardResponseDto"];
export type AdminEventsResponse =
  components["schemas"]["AdminEventsResponseDto"];
export type AdminInvitationListResponse =
  components["schemas"]["AdminInvitationListResponseDto"];
export type AdminInvitationDetailResponse =
  components["schemas"]["AdminInvitationDetailResponseDto"];
export type AdminInvitationPublicUrlResponse =
  components["schemas"]["AdminInvitationPublicUrlResponseDto"];
export type ApiErrorEnvelope = components["schemas"]["ApiErrorEnvelopeDto"];
export type GetPublicInvitationResponse =
  paths["/api/public/invitations/{publicCredential}"]["get"]["responses"]["200"]["content"]["application/json"];
export type SubmitPublicRsvpResponse =
  paths["/api/public/invitations/{publicCredential}/rsvp"]["put"]["responses"]["200"]["content"]["application/json"];
export type GetPublicRsvpResponse =
  paths["/api/public/invitations/{publicCredential}/rsvp"]["get"]["responses"]["200"]["content"]["application/json"];
export type PostPublicGuestMessageResponse =
  paths["/api/public/invitations/{publicCredential}/messages"]["post"]["responses"]["201"]["content"]["application/json"];
export type AdminLoginResponse =
  paths["/api/admin/auth/login"]["post"]["responses"]["200"]["content"]["application/json"];
export type AdminMeResponse =
  paths["/api/admin/auth/me"]["get"]["responses"]["200"]["content"]["application/json"];
export type GetAdminDashboardResponse =
  paths["/api/admin/dashboard"]["get"]["responses"]["200"]["content"]["application/json"];
export type GetAdminEventsResponse =
  paths["/api/admin/events"]["get"]["responses"]["200"]["content"]["application/json"];
export type GetAdminInvitationsResponse =
  paths["/api/admin/invitations"]["get"]["responses"]["200"]["content"]["application/json"];
export type GetAdminInvitationDetailResponse =
  paths["/api/admin/invitations/{invitationId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type GetAdminInvitationPublicUrlResponse =
  paths["/api/admin/invitations/{invitationId}/public-url"]["get"]["responses"]["200"]["content"]["application/json"];

export function createInvitationApiClient(
  options?: Parameters<typeof createClient<paths>>[0],
) {
  return createClient<paths>(options);
}

export type InvitationApiClient = ReturnType<typeof createInvitationApiClient>;
