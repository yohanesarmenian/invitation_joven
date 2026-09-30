import "server-only";

import {
  createInvitationApiClient,
  type SubmitPublicGuestMessageRequest,
} from "../../../../packages/api-client/src/index";
import type { GuestMessageResult } from "../messages/state";
import {
  getInvitationApiBaseUrl,
  type RetrievePublicInvitationOptions,
} from "./public-invitation";

export async function submitPublicGuestMessage(
  publicCredential: string,
  body: SubmitPublicGuestMessageRequest,
  options: RetrievePublicInvitationOptions = {},
): Promise<GuestMessageResult> {
  try {
    const client = createInvitationApiClient({
      baseUrl: getInvitationApiBaseUrl(options.env),
      fetch: options.fetch,
    });
    const result = await client.POST(
      "/api/public/invitations/{publicCredential}/messages",
      {
        params: { path: { publicCredential } },
        body,
        cache: "no-store",
      },
    );
    if (!result.response.ok) {
      const error: unknown = result.error;
      const code =
        isRecord(error) && isRecord(error.error) ? error.error.code : null;
      return {
        status: "error",
        kind:
          result.response.status === 400 && code === "VALIDATION_ERROR"
            ? "validation"
            : result.response.status === 404 &&
                code === "INVITATION_NOT_AVAILABLE"
              ? "unavailable"
              : "server",
      };
    }
    const data: unknown = result.data;
    if (
      result.response.status !== 201 ||
      !isRecord(data) ||
      !isRecord(data.message) ||
      typeof data.message.createdAt !== "string"
    )
      return { status: "error", kind: "uncertain" };
    // Whitelist the public result; never forward unexpected echoes or metadata.
    return {
      status: "success",
      data: { message: { createdAt: data.message.createdAt } },
    };
  } catch {
    // A lost or unreadable response may follow a committed append. Never retry here.
    return { status: "error", kind: "uncertain" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
