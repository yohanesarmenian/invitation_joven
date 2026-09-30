import { describe, expect, it, vi } from "vitest";
import { submitPublicGuestMessage } from "./public-guest-message";

const credential = "synthetic-public-credential";
const env = { INVITATION_API_BASE_URL: "https://api.example.test" };
const body = {
  authorName: "Jo",
  message: "Congratulations!\n\nGod bless you both!",
};
const data = { message: { createdAt: "2026-09-30T00:00:00Z" } };

describe("public guest message generated client wrapper", () => {
  it("POSTs exactly once with the generated body and returns only createdAt", async () => {
    const fetch = vi.fn(async (input: Request) => {
      expect(input.method).toBe("POST");
      expect(input.url).toBe(
        `https://api.example.test/api/public/invitations/${credential}/messages`,
      );
      expect(input.cache).toBe("no-store");
      expect(await input.json()).toEqual(body);
      return Response.json(data, { status: 201 });
    });
    expect(
      await submitPublicGuestMessage(credential, body, { env, fetch }),
    ).toEqual({ status: "success", data });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not forward unexpected upstream fields or content echoes", async () => {
    const result = await submitPublicGuestMessage(credential, body, {
      env,
      fetch: async () =>
        Response.json(
          {
            message: {
              ...data.message,
              id: "private",
              invitationId: "private",
              isHidden: false,
              authorName: body.authorName,
              message: body.message,
            },
            extra: credential,
          },
          { status: 201 },
        ),
    });
    expect(result).toEqual({ status: "success", data });
  });
  it.each([
    null,
    {},
    [],
    { message: null },
    { message: [] },
    { message: {} },
    { message: { createdAt: 42 } },
    { createdAt: "wrong nesting" },
  ])(
    "treats malformed success as uncertain without resending",
    async (payload) => {
      const fetch = vi.fn(async () => Response.json(payload, { status: 201 }));
      expect(
        await submitPublicGuestMessage(credential, body, { env, fetch }),
      ).toEqual({ status: "error", kind: "uncertain" });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("requires 201 rather than accepting an unexpected success status", async () => {
    expect(
      await submitPublicGuestMessage(credential, body, {
        env,
        fetch: async () => Response.json(data),
      }),
    ).toEqual({ status: "error", kind: "uncertain" });
  });
  it.each([
    [400, "VALIDATION_ERROR", "validation"],
    [404, "INVITATION_NOT_AVAILABLE", "unavailable"],
    [500, "INTERNAL_SERVER_ERROR", "server"],
    [400, "unknown", "server"],
  ] as const)(
    "maps %s safely to a bounded failure kind",
    async (status, code, kind) => {
      const fetch = vi.fn(async () =>
        Response.json(
          {
            error: {
              code,
              message: body.message,
              details: { authorName: body.authorName, credential },
            },
          },
          { status },
        ),
      );
      expect(
        await submitPublicGuestMessage(credential, body, { env, fetch }),
      ).toEqual({ status: "error", kind });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("does not expose transport exceptions or automatically retry", async () => {
    const fetch = vi.fn(async () => {
      throw new Error(`${credential} ${body.message}`);
    });
    expect(
      await submitPublicGuestMessage(credential, body, { env, fetch }),
    ).toEqual({ status: "error", kind: "uncertain" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("treats invalid JSON as uncertain", async () => {
    expect(
      await submitPublicGuestMessage(credential, body, {
        env,
        fetch: async () => new Response("not-json", { status: 201 }),
      }),
    ).toEqual({ status: "error", kind: "uncertain" });
  });
});
