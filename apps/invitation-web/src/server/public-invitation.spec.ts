import { describe, expect, it } from "vitest";
import {
  INVITATION_API_BASE_URL,
  InvitationApiConfigurationError,
  PublicInvitationRetrievalError,
  getInvitationApiBaseUrl,
  retrievePublicInvitation,
} from "./public-invitation.js";
import type { PublicInvitationResponse } from "../../../../packages/api-client/src/index.js";

const VALID_ENV = {
  [INVITATION_API_BASE_URL]: "https://api.example.test/",
};
const MIXED_CASE_CREDENTIAL = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbC";

const publicInvitationResponse = {
  invitation: {
    displayName: "Example Household",
    events: [],
    greetingName: "Example",
    invitees: [],
    rsvp: null,
    rsvpDeadlineAt: null,
    rules: {
      allowPlusOne: false,
      maxAdditionalChildren: 0,
    },
  },
} satisfies PublicInvitationResponse;

describe("invitation API base configuration", () => {
  it("accepts valid HTTP and HTTPS URLs and normalizes one trailing slash", () => {
    expect(
      getInvitationApiBaseUrl({
        [INVITATION_API_BASE_URL]: "http://localhost:4000",
      }),
    ).toBe("http://localhost:4000");
    expect(getInvitationApiBaseUrl(VALID_ENV)).toBe("https://api.example.test");
  });

  it.each([
    ["missing", {}],
    ["empty", { [INVITATION_API_BASE_URL]: "" }],
    ["blank", { [INVITATION_API_BASE_URL]: "   " }],
    ["relative", { [INVITATION_API_BASE_URL]: "/api" }],
    ["unsupported protocol", { [INVITATION_API_BASE_URL]: "ftp://api.test" }],
    [
      "embedded credentials",
      { [INVITATION_API_BASE_URL]: "https://user:password@api.example.test" },
    ],
  ])("rejects %s values without echoing the configured value", (_, env) => {
    expect(() => getInvitationApiBaseUrl(env)).toThrow(
      InvitationApiConfigurationError,
    );

    try {
      getInvitationApiBaseUrl(env);
    } catch (error) {
      expect(String(error)).not.toContain("user:password");
      expect(String(error)).not.toContain("ftp://api.test");
    }
  });
});

describe("public invitation retrieval", () => {
  it("calls the generated public invitation operation once with the exact credential", async () => {
    const requests: Request[] = [];
    const fetch = async (request: Request): Promise<Response> => {
      requests.push(request);

      return Response.json(publicInvitationResponse);
    };

    const result = await retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
      env: VALID_ENV,
      fetch,
    });

    expect(result).toEqual({
      status: "success",
      data: publicInvitationResponse,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `https://api.example.test/api/public/invitations/${MIXED_CASE_CREDENTIAL}`,
    );
  });

  it("uses no-store fetch semantics for open-count safety", async () => {
    const requests: Request[] = [];
    const fetch = async (request: Request): Promise<Response> => {
      requests.push(request);

      return Response.json(publicInvitationResponse);
    };

    await retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
      env: VALID_ENV,
      fetch,
    });

    expect(requests[0]?.cache).toBe("no-store");
  });

  it("maps only the public unavailable envelope to unavailable", async () => {
    const fetch = async (): Promise<Response> =>
      Response.json(
        {
          error: {
            code: "INVITATION_NOT_AVAILABLE",
            details: null,
            message: "Resource not found",
          },
          requestId: "request-id",
          timestamp: "2026-09-23T00:00:00.000Z",
        },
        { status: 404 },
      );

    await expect(
      retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
        env: VALID_ENV,
        fetch,
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("treats backend 500 responses as unexpected failures", async () => {
    const fetch = async (): Promise<Response> =>
      Response.json(
        {
          error: {
            code: "INTERNAL_SERVER_ERROR",
            details: null,
            message: "Internal error",
          },
          requestId: "request-id",
          timestamp: "2026-09-23T00:00:00.000Z",
        },
        { status: 500 },
      );

    await expect(
      retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
        env: VALID_ENV,
        fetch,
      }),
    ).rejects.toThrow(PublicInvitationRetrievalError);
  });

  it("treats non-contract 404 responses as unexpected failures", async () => {
    const fetch = async (): Promise<Response> =>
      Response.json(
        {
          error: {
            code: "OTHER_NOT_FOUND",
            details: null,
            message: "Not found",
          },
          requestId: "request-id",
          timestamp: "2026-09-23T00:00:00.000Z",
        },
        { status: 404 },
      );

    await expect(
      retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
        env: VALID_ENV,
        fetch,
      }),
    ).rejects.toThrow(PublicInvitationRetrievalError);
  });

  it("treats malformed success responses as unexpected failures", async () => {
    const fetch = async (): Promise<Response> =>
      Response.json({ invitation: { displayName: "Missing arrays" } });

    await expect(
      retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
        env: VALID_ENV,
        fetch,
      }),
    ).rejects.toThrow(PublicInvitationRetrievalError);
  });

  it("sanitizes network failures before throwing", async () => {
    const fetch = async (): Promise<Response> => {
      throw new Error(
        `Failed to fetch https://api.example.test/api/public/invitations/${MIXED_CASE_CREDENTIAL}`,
      );
    };

    await expect(
      retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
        env: VALID_ENV,
        fetch,
      }),
    ).rejects.toThrow("Public invitation retrieval failed.");

    await retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
      env: VALID_ENV,
      fetch,
    }).catch((error: unknown) => {
      expect(String(error)).not.toContain(MIXED_CASE_CREDENTIAL);
      expect(String(error)).not.toContain("api.example.test");
    });
  });
});
