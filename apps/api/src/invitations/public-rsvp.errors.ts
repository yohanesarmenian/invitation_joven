export const publicRsvpErrorCodes = [
  "RSVP_VERSION_CONFLICT",
  "RSVP_DEADLINE_PASSED",
  "EVENT_NOT_ALLOWED",
  "EVENT_NOT_SELECTED",
  "RSVP_LOCKED_AFTER_CHECKIN",
  "PLUS_ONE_NOT_ALLOWED",
  "ADDITIONAL_CHILD_LIMIT_EXCEEDED",
  "RSVP_ATTENDEE_INVALID",
] as const;

export type PublicRsvpErrorCode = (typeof publicRsvpErrorCodes)[number];

export const publicRsvpErrorHttpStatus: Record<PublicRsvpErrorCode, 409 | 422> = {
  RSVP_VERSION_CONFLICT: 409,
  RSVP_DEADLINE_PASSED: 422,
  EVENT_NOT_ALLOWED: 422,
  EVENT_NOT_SELECTED: 422,
  RSVP_LOCKED_AFTER_CHECKIN: 409,
  PLUS_ONE_NOT_ALLOWED: 422,
  ADDITIONAL_CHILD_LIMIT_EXCEEDED: 422,
  RSVP_ATTENDEE_INVALID: 422,
};

const PUBLIC_RSVP_ERROR_MESSAGES: Record<PublicRsvpErrorCode, string> = {
  RSVP_VERSION_CONFLICT: "RSVP version conflict",
  RSVP_DEADLINE_PASSED: "RSVP deadline passed",
  EVENT_NOT_ALLOWED: "Event is not allowed",
  EVENT_NOT_SELECTED: "Event is not selected",
  RSVP_LOCKED_AFTER_CHECKIN: "RSVP is locked after check-in.",
  PLUS_ONE_NOT_ALLOWED: "Plus-one is not allowed",
  ADDITIONAL_CHILD_LIMIT_EXCEEDED: "Additional child limit exceeded",
  RSVP_ATTENDEE_INVALID: "RSVP attendee invalid",
};

export class PublicRsvpDomainError extends Error {
  readonly details = null;
  readonly httpStatus: 409 | 422;

  constructor(readonly code: PublicRsvpErrorCode) {
    super(PUBLIC_RSVP_ERROR_MESSAGES[code]);
    this.name = "PublicRsvpDomainError";
    this.httpStatus = publicRsvpErrorHttpStatus[code];
  }
}

export function isPublicRsvpDomainError(
  error: unknown,
): error is PublicRsvpDomainError {
  return error instanceof PublicRsvpDomainError;
}
