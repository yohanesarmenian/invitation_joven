export const checkinErrorCodes = [
  "QR_INVALID",
  "QR_REVOKED",
  "EVENT_NOT_ALLOWED",
  "EVENT_NOT_SELECTED",
  "INVALID_ATTENDEE_COUNT",
  "CHECKIN_ALREADY_CONFIRMED",
] as const;

export type CheckinErrorCode = (typeof checkinErrorCodes)[number];

export const checkinErrorHttpStatus: Record<CheckinErrorCode, 409 | 422> = {
  QR_INVALID: 422,
  QR_REVOKED: 422,
  EVENT_NOT_ALLOWED: 422,
  EVENT_NOT_SELECTED: 422,
  INVALID_ATTENDEE_COUNT: 422,
  CHECKIN_ALREADY_CONFIRMED: 409,
};

const CHECKIN_ERROR_MESSAGES: Record<CheckinErrorCode, string> = {
  QR_INVALID: "QR credential is invalid",
  QR_REVOKED: "QR credential is revoked",
  EVENT_NOT_ALLOWED: "Event is not allowed",
  EVENT_NOT_SELECTED: "Event is not selected",
  INVALID_ATTENDEE_COUNT: "Invalid attendee count",
  CHECKIN_ALREADY_CONFIRMED: "Check-in already confirmed",
};

export class CheckinDomainError extends Error {
  readonly details = null;
  readonly httpStatus: 409 | 422;

  constructor(readonly code: CheckinErrorCode) {
    super(CHECKIN_ERROR_MESSAGES[code]);
    this.name = "CheckinDomainError";
    this.httpStatus = checkinErrorHttpStatus[code];
  }
}

export function isCheckinDomainError(
  error: unknown,
): error is CheckinDomainError {
  return error instanceof CheckinDomainError;
}
