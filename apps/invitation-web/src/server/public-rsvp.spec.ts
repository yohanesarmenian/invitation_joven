import { describe, expect, it, vi } from "vitest";
import { retrievePublicRsvp, submitPublicRsvp } from "./public-rsvp";
import {
  acceptedRsvp,
  activePass,
} from "../../components/invitation/public-rsvp.fixtures";
import type { SubmitPublicRsvpRequest } from "../../../../packages/api-client/src/index";

const credential = "test-credential-not-a-secret";
const env = { INVITATION_API_BASE_URL: "https://api.example.test" };
const request: SubmitPublicRsvpRequest = {
  expectedVersion: null,
  status: "DECLINED",
  eventSelections: [],
  attendees: [],
  dietaryNotes: null,
};

describe("generated public RSVP networking", () => {
  it.each(["GET", "PUT"])(
    "retains the complete canonical active pass from %s",
    async (method) => {
      const data = { rsvp: acceptedRsvp, checkinPass: activePass };
      const options = { env, fetch: async () => Response.json(data) };
      const result =
        method === "GET"
          ? await retrievePublicRsvp(credential, options)
          : await submitPublicRsvp(credential, request, options);
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(
          result.data.checkinPass?.qrPayload === activePass.qrPayload,
        ).toBe(true);
        expect(result.data.rsvp?.version).toBe(acceptedRsvp.version);
      }
    },
  );
  it.each([
    undefined,
    null,
    42,
    "",
    "x".repeat(42),
    "x".repeat(44),
    "x".repeat(42) + "=",
    "x".repeat(42) + "/",
    "x".repeat(42) + " ",
    "x".repeat(43) + "\n",
    "x".repeat(43) + "\r\n",
  ])("rejects an absent or malformed pass payload", async (qrPayload) => {
    const result = await retrievePublicRsvp(credential, {
      env,
      fetch: async () =>
        Response.json({
          rsvp: acceptedRsvp,
          checkinPass: { ...activePass, qrPayload },
        }),
    });
    expect(result).toEqual({
      status: "error",
      error: { kind: "invalid-response", httpStatus: 200, code: null },
    });
  });
  it("loads detailed state using the generated GET with no caching", async () => {
    const fetch = vi.fn(async (input: Request) => {
      expect(input.url).toBe(
        `https://api.example.test/api/public/invitations/${credential}/rsvp`,
      );
      expect(input.method).toBe("GET");
      expect(input.cache).toBe("no-store");
      return Response.json({ rsvp: null, checkinPass: null });
    });
    expect(await retrievePublicRsvp(credential, { env, fetch })).toEqual({
      status: "success",
      data: { rsvp: null, checkinPass: null },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, 7])(
    "sends exact generated PUT payload with version %s",
    async (expectedVersion) => {
      const body = { ...request, expectedVersion };
      const data = {
        rsvp: {
          ...acceptedRsvp,
          status: "DECLINED",
          version: 42,
          attendees: [],
          eventSelections: [],
          dietaryNotes: null,
          attendeeQuantityTotal: 0,
        },
        checkinPass: null,
      };
      const fetch = vi.fn(async (input: Request) => {
        expect(input.method).toBe("PUT");
        expect(input.cache).toBe("no-store");
        expect(await input.json()).toEqual(body);
        return Response.json(data);
      });
      expect(await submitPublicRsvp(credential, body, { env, fetch })).toEqual({
        status: "success",
        data,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [409, "RSVP_VERSION_CONFLICT"],
    [422, "RSVP_DEADLINE_PASSED"],
    [422, "EVENT_NOT_ALLOWED"],
    [404, "INVITATION_NOT_AVAILABLE"],
  ] as const)(
    "preserves %s / %s without raw messages",
    async (httpStatus, code) => {
      const fetch = async () =>
        Response.json(
          { error: { code, message: `Unsafe ${credential}`, details: null } },
          { status: httpStatus },
        );
      const result = await submitPublicRsvp(credential, request, {
        env,
        fetch,
      });
      expect(result).toEqual({
        status: "error",
        error: { kind: "api", httpStatus, code },
      });
      expect(JSON.stringify(result)).not.toContain(credential);
    },
  );
  it("preserves initial read failures rather than treating them as an unanswered RSVP", async () => {
    const result = await retrievePublicRsvp(credential, {
      env,
      fetch: async () =>
        Response.json(
          { error: { code: "INVITATION_NOT_AVAILABLE" } },
          { status: 404 },
        ),
    });
    expect(result).toEqual({
      status: "error",
      error: { kind: "api", httpStatus: 404, code: "INVITATION_NOT_AVAILABLE" },
    });
  });
  it("returns a safe network error without exception messages", async () => {
    const result = await submitPublicRsvp(credential, request, {
      env,
      fetch: async () => {
        throw new Error(`Failed URL ${credential}`);
      },
    });
    expect(result).toEqual({
      status: "error",
      error: { kind: "network", httpStatus: null, code: null },
    });
  });
  it.each([
    {},
    { rsvp: null },
    { rsvp: { ...acceptedRsvp, version: null }, checkinPass: null },
    { rsvp: { ...acceptedRsvp, eventSelections: "broken" }, checkinPass: null },
  ])("rejects malformed success data", async (data) => {
    expect(
      await retrievePublicRsvp(credential, {
        env,
        fetch: async () => Response.json(data),
      }),
    ).toEqual({
      status: "error",
      error: { kind: "invalid-response", httpStatus: 200, code: null },
    });
  });
  it("rejects a mutation without a persisted RSVP", async () => {
    expect(
      await submitPublicRsvp(credential, request, {
        env,
        fetch: async () => Response.json({ rsvp: null, checkinPass: null }),
      }),
    ).toEqual({
      status: "error",
      error: { kind: "invalid-response", httpStatus: 200, code: null },
    });
  });
});
