import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export type RequestIdCarrier = {
  id?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export function getHeaderRequestId(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const value = headers?.[REQUEST_ID_HEADER];
  const requestId = Array.isArray(value) ? value[0] : value;

  return isValidRequestId(requestId) ? requestId : undefined;
}

export function ensureRequestId(request: RequestIdCarrier): string {
  if (isValidRequestId(request.id)) {
    return request.id;
  }

  const requestId = getHeaderRequestId(request.headers) ?? randomUUID();
  request.id = requestId;

  return requestId;
}
