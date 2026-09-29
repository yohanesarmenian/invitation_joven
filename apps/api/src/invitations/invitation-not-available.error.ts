export const INVITATION_NOT_AVAILABLE_CODE = "INVITATION_NOT_AVAILABLE";
export const INVITATION_NOT_AVAILABLE_MESSAGE = "Resource not found";

export class InvitationNotAvailableError extends Error {
  readonly code = INVITATION_NOT_AVAILABLE_CODE;
  readonly details = null;

  constructor() {
    super(INVITATION_NOT_AVAILABLE_MESSAGE);
    this.name = "InvitationNotAvailableError";
  }
}

export function isInvitationNotAvailableError(
  error: unknown,
): error is InvitationNotAvailableError {
  return error instanceof InvitationNotAvailableError;
}
