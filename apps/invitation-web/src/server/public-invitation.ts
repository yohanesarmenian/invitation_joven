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

function isPublicInvitationResponse(
  value: unknown,
): value is PublicInvitationResponse {
  return (
    isRecord(value) &&
    isRecord(value.invitation) &&
    typeof value.invitation.displayName === "string" &&
    Array.isArray(value.invitation.events) &&
    Array.isArray(value.invitation.invitees) &&
    isRecord(value.invitation.rules)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
