import "server-only";

import {
  createInvitationApiClient,
  type ApiErrorEnvelope,
  type PublicInvitationResponse,
} from "../../../../packages/api-client/src/index";

export const INVITATION_API_BASE_URL = "INVITATION_API_BASE_URL";
const PUBLIC_INVITATION_PATH = "/api/public/invitations/{publicCredential}";
const INVITATION_NOT_AVAILABLE = "INVITATION_NOT_AVAILABLE";

type InvitationWebEnv = Record<string, string | undefined>;

export type RetrievePublicInvitationResult =
  | {
      status: "success";
      data: PublicInvitationResponse;
    }
  | {
      status: "unavailable";
    };

export type RetrievePublicInvitationOptions = {
  env?: InvitationWebEnv;
  fetch?: (input: Request) => Promise<Response>;
};

export class InvitationApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationApiConfigurationError";
  }
}

export class PublicInvitationRetrievalError extends Error {
  constructor(message = "Public invitation retrieval failed.") {
    super(message);
    this.name = "PublicInvitationRetrievalError";
  }
}

export function getInvitationApiBaseUrl(
  env: InvitationWebEnv = process.env,
): string {
  const value = env[INVITATION_API_BASE_URL];

  if (value === undefined) {
    throw new InvitationApiConfigurationError(
      `${INVITATION_API_BASE_URL} is required for public invitation retrieval.`,
    );
  }

  if (value.trim().length === 0) {
    throw new InvitationApiConfigurationError(
      `${INVITATION_API_BASE_URL} must be a non-empty HTTP(S) URL.`,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvitationApiConfigurationError(
      `${INVITATION_API_BASE_URL} must be a valid absolute HTTP(S) URL.`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InvitationApiConfigurationError(
      `${INVITATION_API_BASE_URL} must use HTTP or HTTPS.`,
    );
  }

  if (url.username !== "" || url.password !== "") {
    throw new InvitationApiConfigurationError(
      `${INVITATION_API_BASE_URL} must not include embedded credentials.`,
    );
  }

  if (url.search !== "" || url.hash !== "") {
    throw new InvitationApiConfigurationError(
      `${INVITATION_API_BASE_URL} must not include a query string or fragment.`,
    );
  }

  return url.toString().replace(/\/$/, "");
}

export async function retrievePublicInvitation(
  publicCredential: string,
  options: RetrievePublicInvitationOptions = {},
): Promise<RetrievePublicInvitationResult> {
  const baseUrl = getInvitationApiBaseUrl(options.env);
  const client = createInvitationApiClient({
    baseUrl,
    fetch: options.fetch,
  });

  const result = await client
    .GET(PUBLIC_INVITATION_PATH, {
      cache: "no-store",
      params: {
        path: {
          publicCredential,
        },
      },
    })
    .catch(() => {
      throw new PublicInvitationRetrievalError();
    });

  const data: unknown = result.data;
  if (isPublicInvitationResponse(data)) {
    return {
      status: "success",
      data,
    };
  }

  const error: unknown = "error" in result ? result.error : undefined;
  if (
    result.response.status === 404 &&
    isApiErrorEnvelope(error) &&
    error.error.code === INVITATION_NOT_AVAILABLE
  ) {
    return { status: "unavailable" };
  }

  throw new PublicInvitationRetrievalError();
}

function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }

  return typeof value.error.code === "string";
}

// Structural guard for the public success payload. It validates shape only:
// no transformation, no date parsing, no URL parsing, no enum beyond the
// contract's own unions. Unknown extra properties are permitted.
function isPublicInvitationResponse(
  value: unknown,
): value is PublicInvitationResponse {
  if (!isRecord(value) || !isRecord(value.invitation)) {
    return false;
  }

  const { invitation } = value;

  return (
    typeof invitation.displayName === "string" &&
    isNullableString(invitation.greetingName) &&
    isNullableString(invitation.rsvpDeadlineAt) &&
    Array.isArray(invitation.events) &&
    invitation.events.every(isPublicInvitationEvent) &&
    Array.isArray(invitation.invitees) &&
    invitation.invitees.every(isPublicInvitationInvitee) &&
    isPublicInvitationRules(invitation.rules) &&
    isPublicInvitationRsvp(invitation.rsvp)
  );
}

function isPublicInvitationEvent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    isNullableString(value.startsAt) &&
    isNullableString(value.venueName) &&
    isNullableString(value.address) &&
    isNullableString(value.googleMapsUrl)
  );
}

function isPublicInvitationInvitee(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.fullName === "string" &&
    (value.category === "ADULT" || value.category === "CHILD")
  );
}

function isPublicInvitationRules(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.allowPlusOne === "boolean" &&
    typeof value.maxAdditionalChildren === "number" &&
    Number.isFinite(value.maxAdditionalChildren) &&
    value.maxAdditionalChildren >= 0
  );
}

function isPublicInvitationRsvp(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.status === "PENDING" ||
      value.status === "ACCEPTED" ||
      value.status === "DECLINED") &&
    typeof value.version === "number" &&
    Number.isFinite(value.version) &&
    value.version >= 1
  );
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
