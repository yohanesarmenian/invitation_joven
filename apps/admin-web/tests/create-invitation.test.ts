import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInvitation } from "../src/invitations/create-invitation";
import { auth, failure, json } from "./fixtures";
import { body, item } from "./invitation-fixtures";
const NativeRequest = Request,
  fetchMock = vi.fn();
const publicUrl = "http://localhost:3000/i/" + "A".repeat(43);
beforeEach(() => {
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === "string"
            ? new URL(input, "http://localhost:3001")
            : input,
          init,
        );
      }
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it("sends one exact body with CSRF and returns only the verified in-memory acknowledgement", async () => {
  fetchMock.mockResolvedValue(
    json(
      {
        invitation: item,
        publicTokenVersion: 1,
        publicUrl,
      },
      201,
    ),
  );
  expect(await createInvitation(body, "synthetic-csrf")).toEqual({
    kind: "created",
    invitationId: item.id,
    publicUrl,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.url).toBe("http://localhost:3001/api/admin/invitations");
  expect(req.method).toBe("POST");
  expect(req.credentials).toBe("same-origin");
  expect(req.cache).toBe("no-store");
  expect(req.redirect).toBe("error");
  expect(req.headers.get("x-csrf-token")).toBe("synthetic-csrf");
  expect(req.headers.has("cookie")).toBe(false);
  expect(req.headers.has("idempotency-key")).toBe(false);
  expect(await req.json()).toEqual(body);
});
it.each([
  [400, "VALIDATION_ERROR", "rejected"],
  [401, "UNAUTHENTICATED", "session-ended"],
  [403, "FORBIDDEN", "rejected"],
  [409, "CONFLICT", "rejected"],
  [500, "INTERNAL_ERROR", "uncertain"],
  [400, "unknown", "uncertain"],
])("contains %s %s without retry", async (status, code, kind) => {
  fetchMock.mockResolvedValue(failure(String(code), Number(status)));
  const result = await createInvitation(body, "csrf");
  expect(result.kind).toBe(kind);
  expect(JSON.stringify(result)).not.toContain("Private");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([
  null,
  {},
  { invitation: {} },
  { invitation: item, publicTokenVersion: 1 },
])("malformed success stays uncertain %#", async (value) => {
  fetchMock.mockResolvedValue(json(value, 201));
  expect(await createInvitation(body, "csrf")).toEqual({ kind: "uncertain" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("network interruption never repeats POST", async () => {
  fetchMock.mockRejectedValue(new Error("private"));
  expect(await createInvitation(body, "csrf")).toEqual({ kind: "uncertain" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("CSRF rejection refreshes once but never replays POST", async () => {
  fetchMock
    .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
    .mockResolvedValueOnce(json(auth));
  expect(await createInvitation(body, "old")).toEqual({
    kind: "csrf",
    csrfToken: auth.csrfToken,
  });
  expect(fetchMock.mock.calls.map((call) => call[0].method)).toEqual([
    "POST",
    "GET",
  ]);
});
it.each([
  [401, "session-ended"],
  [403, "reload"],
  [500, "reload"],
])("contains CSRF refresh failure %s", async (status, kind) => {
  fetchMock
    .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
    .mockResolvedValueOnce(failure("private", Number(status)));
  expect((await createInvitation(body, "old")).kind).toBe(kind);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
