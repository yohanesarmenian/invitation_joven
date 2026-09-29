import type { ApiErrorEnvelope } from "../../../../packages/api-client/src/index";

// Keep machine-readable error identity for the later result/recovery UI. Never
// forward raw exception text or upstream messages that could contain a URL.
export type RsvpFailure = {
  kind: "api" | "network" | "invalid-response";
  httpStatus: number | null;
  code: ApiErrorEnvelope["error"]["code"] | null;
};

export type RsvpResult<T> =
  { status: "success"; data: T } | { status: "error"; error: RsvpFailure };
