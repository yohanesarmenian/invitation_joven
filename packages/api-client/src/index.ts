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
export type CreateAdminInvitationRequest =
  components["schemas"]["CreateAdminInvitationRequestDto"];
export type CreateAdminInvitationResponse =
  components["schemas"]["CreateAdminInvitationResponseDto"];
export type UpdateAdminInvitationRequest =
  components["schemas"]["UpdateAdminInvitationRequestDto"];
export type ArchiveAdminInvitationResponse =
  components["schemas"]["ArchiveAdminInvitationResponseDto"];
export type RegenerateInvitationTokenRequest =
  components["schemas"]["RegenerateInvitationTokenRequestDto"];
export type CreateAdminInviteeRequest =
  components["schemas"]["CreateAdminInviteeRequestDto"];
export type UpdateAdminInviteeRequest =
  components["schemas"]["UpdateAdminInviteeRequestDto"];
export type AdminInviteeMutationResponse =
  components["schemas"]["AdminInviteeMutationDto"];
export type ReplaceAdminInvitationEventsRequest =
  components["schemas"]["ReplaceAdminInvitationEventsRequestDto"];
export type ReplaceAdminInvitationEventsResponse =
  components["schemas"]["ReplaceAdminInvitationEventsResponseDto"];
export type OverrideAdminRsvpRequest =
  components["schemas"]["OverrideAdminRsvpRequestDto"];
export type AdminRsvpListResponse =
  components["schemas"]["AdminRsvpListResponseDto"];
export type AdminRsvpDetailResponse =
  components["schemas"]["AdminRsvpDetailResponseDto"];
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
export type CreateAdminInvitationOperationResponse =
  paths["/api/admin/invitations"]["post"]["responses"]["201"]["content"]["application/json"];
export type GetAdminInvitationDetailResponse =
  paths["/api/admin/invitations/{invitationId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type UpdateAdminInvitationOperationResponse =
  paths["/api/admin/invitations/{invitationId}"]["patch"]["responses"]["200"]["content"]["application/json"];
export type ArchiveAdminInvitationOperationResponse =
  paths["/api/admin/invitations/{invitationId}/archive"]["post"]["responses"]["200"]["content"]["application/json"];
export type RegenerateInvitationTokenOperationResponse =
  paths["/api/admin/invitations/{invitationId}/regenerate-token"]["post"]["responses"]["200"]["content"]["application/json"];
export type CreateAdminInviteeOperationResponse =
  paths["/api/admin/invitations/{invitationId}/invitees"]["post"]["responses"]["201"]["content"]["application/json"];
export type UpdateAdminInviteeOperationResponse =
  paths["/api/admin/invitees/{inviteeId}"]["patch"]["responses"]["200"]["content"]["application/json"];
export type ReplaceAdminInvitationEventsOperationResponse =
  paths["/api/admin/invitations/{invitationId}/events"]["put"]["responses"]["200"]["content"]["application/json"];
export type OverrideAdminRsvpOperationResponse =
  paths["/api/admin/invitations/{invitationId}/rsvp"]["put"]["responses"]["200"]["content"]["application/json"];
export type GetAdminRsvpsResponse =
  paths["/api/admin/rsvps"]["get"]["responses"]["200"]["content"]["application/json"];
export type GetAdminRsvpDetailResponse =
  paths["/api/admin/rsvps/{rsvpId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type GetAdminInvitationPublicUrlResponse =
  paths["/api/admin/invitations/{invitationId}/public-url"]["get"]["responses"]["200"]["content"]["application/json"];

export function createInvitationApiClient(
  options?: Parameters<typeof createClient<paths>>[0],
) {
  return createClient<paths>(options);
}

export type InvitationApiClient = ReturnType<typeof createInvitationApiClient>;
