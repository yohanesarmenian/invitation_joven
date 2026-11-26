export const MAX_INVITATION_SESSIONS = 2;

export function isSupportedInvitationSessionCount(count: number): boolean {
  return count >= 1 && count <= MAX_INVITATION_SESSIONS;
}
