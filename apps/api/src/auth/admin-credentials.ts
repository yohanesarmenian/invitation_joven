import { validationError } from "./auth-errors.js";

const EMAIL_MAX_CODE_POINTS = 254;
const PASSWORD_MIN_CODE_POINTS = 15;
const PASSWORD_MAX_CODE_POINTS = 128;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function countCodePoints(value: string): number {
  return [...value].length;
}

export function normalizeAdminEmail(value: unknown): string {
  if (typeof value !== "string") {
    validationError();
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized.length === 0 ||
    countCodePoints(normalized) > EMAIL_MAX_CODE_POINTS ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    validationError();
  }

  return normalized;
}

export function validateAdminPassword(value: unknown): string {
  if (typeof value !== "string") {
    validationError();
  }

  const length = countCodePoints(value);

  if (length < PASSWORD_MIN_CODE_POINTS || length > PASSWORD_MAX_CODE_POINTS) {
    validationError();
  }

  return value;
}
