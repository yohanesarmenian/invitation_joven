import "server-only";

import {
  createInvitationApiClient,
  type PublicRsvpReadResponse,
  type PublicRsvpMutationResponse,
  type SubmitPublicRsvpRequest,
} from "../../../../packages/api-client/src/index";
import type { RsvpResult } from "../rsvp/result";
import {
  getInvitationApiBaseUrl,
  type RetrievePublicInvitationOptions,
} from "./public-invitation";

const RSVP_PATH = "/api/public/invitations/{publicCredential}/rsvp";

export function retrievePublicRsvp(
  publicCredential: string,
  options: RetrievePublicInvitationOptions = {},
): Promise<RsvpResult<PublicRsvpReadResponse>> {
  return requestRsvp(publicCredential, undefined, options, isRsvpReadResponse);
}

export async function submitPublicRsvp(
  publicCredential: string,
  body: SubmitPublicRsvpRequest,
  options: RetrievePublicInvitationOptions = {},
): Promise<RsvpResult<PublicRsvpMutationResponse>> {
  const result = await requestRsvp(
    publicCredential,
    body,
    options,
    isRsvpResponse,
  );
  if (result.status === "error") return result;
  if (result.data.rsvp === null) return invalidResponse(200);
  return {
    status: "success",
    data: { checkinPass: result.data.checkinPass, rsvp: result.data.rsvp },
  };
}

async function requestRsvp<T>(
  publicCredential: string,
  body: SubmitPublicRsvpRequest | undefined,
  options: RetrievePublicInvitationOptions,
  validate: (value: unknown) => value is T,
): Promise<RsvpResult<T>> {
  const client = createInvitationApiClient({
    baseUrl: getInvitationApiBaseUrl(options.env),
    fetch: options.fetch,
  });
  try {
    const request = {
      cache: "no-store" as const,
      params: { path: { publicCredential } },
    };
    const result =
      body === undefined
        ? await client.GET(RSVP_PATH, request)
        : await client.PUT(RSVP_PATH, { ...request, body });

    if (!result.response.ok) {
      const error: unknown = result.error;
      return {
        status: "error",
        error: {
          kind: "api",
          httpStatus: result.response.status,
          code:
            isRecord(error) &&
            isRecord(error.error) &&
            typeof error.error.code === "string"
              ? error.error.code
              : null,
        },
      };
    }
    if (!validate(result.data)) return invalidResponse(result.response.status);
    return { status: "success", data: result.data };
  } catch {
    return {
      status: "error",
      error: { kind: "network", httpStatus: null, code: null },
    };
  }
}

function invalidResponse(httpStatus: number): RsvpResult<never> {
  return {
    status: "error",
    error: { kind: "invalid-response", httpStatus, code: null },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Validate the generated success shape before an absent/broken response could
// be mistaken for a new RSVP and submitted with expectedVersion: null.
function isRsvpReadResponse(value: unknown): value is PublicRsvpReadResponse {
  if (!isRecord(value)) return false;
  const validPolicy =
    (value.canEdit === true && value.editBlockedReason === null) ||
    (value.canEdit === false &&
      (value.editBlockedReason === "DEADLINE_PASSED" ||
        value.editBlockedReason === "CHECKED_IN"));
  return validPolicy && isRsvpResponse(value);
}

function isRsvpResponse(
  value: unknown,
): value is Pick<PublicRsvpReadResponse, "rsvp" | "checkinPass"> {
  if (!isRecord(value)) return false;
  const { rsvp, checkinPass } = value;
  if (
    checkinPass !== null &&
    !(
      isRecord(checkinPass) &&
      checkinPass.status === "ACTIVE" &&
      typeof checkinPass.issuedAt === "string" &&
      typeof checkinPass.qrPayload === "string" &&
      checkinPass.qrPayload.length === 43 &&
      /^[A-Za-z0-9_-]{43}$/.test(checkinPass.qrPayload)
    )
  )
    return false;
  if (rsvp === null) return true;
  return (
    isRecord(rsvp) &&
    ["PENDING", "ACCEPTED", "DECLINED"].includes(String(rsvp.status)) &&
    Number.isInteger(rsvp.version) &&
    Number(rsvp.version) >= 1 &&
    (rsvp.dietaryNotes === null || typeof rsvp.dietaryNotes === "string") &&
    Number.isInteger(rsvp.attendeeQuantityTotal) &&
    Number(rsvp.attendeeQuantityTotal) >= 0 &&
    Array.isArray(rsvp.eventSelections) &&
    rsvp.eventSelections.every(
      (event: unknown) =>
        isRecord(event) &&
        typeof event.eventId === "string" &&
        typeof event.attending === "boolean" &&
        Number.isInteger(event.expectedAttendeeCount) &&
        Number(event.expectedAttendeeCount) >= 0,
    ) &&
    Array.isArray(rsvp.attendees) &&
    rsvp.attendees.every(
      (attendee: unknown) =>
        isRecord(attendee) &&
        [
          "NAMED_INVITEE",
          "PLUS_ONE",
          "ADDITIONAL_CHILD",
          "UNNAMED_COMPANION",
        ].includes(String(attendee.type)) &&
        (attendee.inviteeId === null ||
          typeof attendee.inviteeId === "string") &&
        Number.isInteger(attendee.quantity) &&
        Number(attendee.quantity) >= 1,
    )
  );
}
