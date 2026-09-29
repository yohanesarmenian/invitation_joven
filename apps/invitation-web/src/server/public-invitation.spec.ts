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

const fullInvitationResponse = {
  invitation: {
    displayName: "Example Household",
    greetingName: "Example",
    rsvpDeadlineAt: "2026-10-01T00:00:00.000Z",
    events: [
      {
        id: "event-1",
        slug: "akad",
        name: "Akad Nikah",
        startsAt: "2026-10-10T02:00:00.000Z",
        venueName: "Example Venue",
        address: "Example Address",
        googleMapsUrl: "https://maps.example.test/?q=example",
      },
      {
        id: "event-2",
        slug: "resepsi",
        name: "Resepsi",
        startsAt: null,
        venueName: null,
        address: null,
        googleMapsUrl: null,
      },
    ],
    invitees: [
      { id: "invitee-1", fullName: "Adult Guest", category: "ADULT" },
      { id: "invitee-2", fullName: "Child Guest", category: "CHILD" },
    ],
    rules: {
      allowPlusOne: true,
      maxAdditionalChildren: 2.5,
    },
    rsvp: {
      status: "ACCEPTED",
      version: 3,
    },
  },
} satisfies PublicInvitationResponse;

const fullInvitation = fullInvitationResponse.invitation;
const [fullEvent] = fullInvitation.events;
const [fullInvitee] = fullInvitation.invitees;

const malformedPayloads: Array<[string, unknown]> = [
  ["missing invitation", {}],
  ["null invitation", { invitation: null }],
  [
    "non-string displayName",
    { invitation: { ...fullInvitation, displayName: 1 } },
  ],
  [
    "wrong greetingName type",
    { invitation: { ...fullInvitation, greetingName: 1 } },
  ],
  [
    "wrong rsvpDeadlineAt type",
    { invitation: { ...fullInvitation, rsvpDeadlineAt: 1 } },
  ],
  ["events not an array", { invitation: { ...fullInvitation, events: {} } }],
  [
    "missing event name",
    { invitation: { ...fullInvitation, events: [{ ...fullEvent, name: undefined }] } },
  ],
  [
    "wrong event startsAt type",
    { invitation: { ...fullInvitation, events: [{ ...fullEvent, startsAt: 1 }] } },
  ],
  ["invitees not an array", { invitation: { ...fullInvitation, invitees: {} } }],
  [
    "wrong invitee id type",
    {
      invitation: {
        ...fullInvitation,
        invitees: [{ ...fullInvitee, id: 1 }],
      },
    },
  ],
  [
    "invalid invitee category enum",
    {
      invitation: {
        ...fullInvitation,
        invitees: [{ ...fullInvitee, category: "GUEST" }],
      },
    },
  ],
  ["missing rules", { invitation: { ...fullInvitation, rules: undefined } }],
  ["null rules", { invitation: { ...fullInvitation, rules: null } }],
  [
    "wrong allowPlusOne type",
    {
      invitation: {
        ...fullInvitation,
        rules: { ...fullInvitation.rules, allowPlusOne: "yes" },
      },
    },
  ],
  [
    "wrong maxAdditionalChildren type",
    {
      invitation: {
        ...fullInvitation,
        rules: { ...fullInvitation.rules, maxAdditionalChildren: "2" },
      },
    },
  ],
  [
    "non-finite maxAdditionalChildren",
    {
      invitation: {
        ...fullInvitation,
        rules: { ...fullInvitation.rules, maxAdditionalChildren: Number.NaN },
      },
    },
  ],
  [
    "negative maxAdditionalChildren",
    {
      invitation: {
        ...fullInvitation,
        rules: { ...fullInvitation.rules, maxAdditionalChildren: -1 },
      },
    },
  ],
  [
    "invalid rsvp status enum",
    { invitation: { ...fullInvitation, rsvp: { status: "MAYBE", version: 1 } } },
  ],
  [
    "missing rsvp version",
    { invitation: { ...fullInvitation, rsvp: { status: "PENDING" } } },
  ],
  [
    "rsvp version below 1",
    { invitation: { ...fullInvitation, rsvp: { status: "PENDING", version: 0 } } },
  ],
];

function respondWith(payload: unknown) {
  const requests: Request[] = [];

  return {
    requests,
    fetch: async (request: Request): Promise<Response> => {
      requests.push(request);

      return Response.json(payload);
    },
  };
}

describe("invitation API base configuration", () => {
  it("accepts valid HTTP and HTTPS URLs and normalizes one trailing slash", () => {
    expect(
      getInvitationApiBaseUrl({
        [INVITATION_API_BASE_URL]: "http://localhost:4000",
      }),
    ).toBe("http://localhost:4000");
    expect(getInvitationApiBaseUrl(VALID_ENV)).toBe("https://api.example.test");
  });

  it("preserves a path prefix and one trailing slash normalization", () => {
    expect(
      getInvitationApiBaseUrl({
        [INVITATION_API_BASE_URL]: "http://127.0.0.1:3001",
      }),
    ).toBe("http://127.0.0.1:3001");
    expect(
      getInvitationApiBaseUrl({
        [INVITATION_API_BASE_URL]: "https://api.example.test/base",
      }),
    ).toBe("https://api.example.test/base");
    expect(
      getInvitationApiBaseUrl({
        [INVITATION_API_BASE_URL]: "https://api.example.test/base/",
      }),
    ).toBe("https://api.example.test/base");
  });

  it.each([
    ["query string", "https://api.example.test?foo=bar"],
    ["fragment", "https://api.example.test/#fragment"],
    ["query string and fragment", "https://api.example.test/base?foo=bar#fragment"],
  ])(
    "rejects a base URL carrying a %s without echoing the configured value",
    (_, value) => {
      const env = { [INVITATION_API_BASE_URL]: value };

      expect(() => getInvitationApiBaseUrl(env)).toThrow(
        InvitationApiConfigurationError,
      );

      try {
        getInvitationApiBaseUrl(env);
      } catch (error) {
        expect(String(error)).not.toContain(value);
      }
    },
  );

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

describe("public invitation payload validation", () => {
  it("accepts the minimum valid payload with a single request", async () => {
    const { requests, fetch } = respondWith(publicInvitationResponse);

    await expect(
      retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
        env: VALID_ENV,
        fetch,
      }),
    ).resolves.toEqual({
      status: "success",
      data: publicInvitationResponse,
    });
    expect(requests).toHaveLength(1);
  });

  it("returns a representative full payload unchanged", async () => {
    const { requests, fetch } = respondWith(fullInvitationResponse);

    const result = await retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
      env: VALID_ENV,
      fetch,
    });

    expect(result).toEqual({
      status: "success",
      data: fullInvitationResponse,
    });
    expect(requests).toHaveLength(1);
  });

  it("accepts unknown extra object properties", async () => {
    const payload = {
      extraTopLevelField: true,
      invitation: {
        ...fullInvitation,
        extraInvitationField: "ignored",
        events: [{ ...fullEvent, extraEventField: "ignored" }],
      },
    };
    const { fetch } = respondWith(payload);

    await expect(
      retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
        env: VALID_ENV,
        fetch,
      }),
    ).resolves.toEqual({ status: "success", data: payload });
  });

  it.each(malformedPayloads)(
    "rejects a malformed success payload: %s",
    async (_, payload) => {
      const { fetch } = respondWith(payload);

      await expect(
        retrievePublicInvitation(MIXED_CASE_CREDENTIAL, {
          env: VALID_ENV,
          fetch,
        }),
      ).rejects.toThrow(PublicInvitationRetrievalError);
    },
  );
});
