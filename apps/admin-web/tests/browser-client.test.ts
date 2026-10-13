import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signIn, signOut } from "../src/auth/browser-client";
import { auth, failure, json } from "./fixtures";
const NativeRequest = Request;
const fetchMock = vi.fn();
beforeEach(() => {
  // Supply browser relative-URL semantics while exercising the actual workspace client.
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
it("login uses generated operation and same-origin credentials", async () => {
  fetchMock.mockResolvedValue(json(auth));
  expect(
    await signIn({
      email: "owner@example.com",
      password: "synthetic password",
    }),
  ).toEqual({ ok: true, auth });
  const request = fetchMock.mock.calls[0]![0] as Request;
  expect(request.url).toBe("http://localhost:3001/api/admin/auth/login");
  expect(request.credentials).toBe("same-origin");
  expect(request.headers.has("cookie")).toBe(false);
  expect(request.headers.has("authorization")).toBe(false);
});
it.each([
  [401, "INVALID_CREDENTIALS"],
  [429, "TOO_MANY_LOGIN_ATTEMPTS"],
  [400, "VALIDATION_ERROR"],
  [500, "INTERNAL_ERROR"],
])("contains backend details for login %i", async (status, code) => {
  fetchMock.mockResolvedValue(failure(String(code), Number(status)));
  const result = await signIn({
    email: "owner@example.com",
    password: "synthetic password",
  });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result).includes("Private backend diagnostic")).toBe(
    false,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects malformed login success", async () => {
  fetchMock.mockResolvedValue(json({}));
  expect(
    (
      await signIn({
        email: "owner@example.com",
        password: "synthetic password",
      })
    ).ok,
  ).toBe(false);
});
it("contains network errors", async () => {
  fetchMock.mockRejectedValue(new Error("private"));
  expect(
    (
      await signIn({
        email: "owner@example.com",
        password: "synthetic password",
      })
    ).ok,
  ).toBe(false);
  expect((await signOut("synthetic-csrf")).kind).toBe("failure");
});
it("logout sends CSRF, leaves cookie ownership to browser, accepts 204", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  expect(await signOut("synthetic-csrf")).toEqual({ kind: "signed-out" });
  const request = fetchMock.mock.calls[0]![0] as Request;
  expect(request.method).toBe("POST");
  expect(request.headers.get("x-csrf-token") === "synthetic-csrf").toBe(true);
  expect(request.headers.has("cookie")).toBe(false);
});
it("logout 401 ends session without retry", async () => {
  fetchMock.mockResolvedValue(failure("UNAUTHENTICATED", 401));
  expect(await signOut("synthetic-csrf")).toEqual({ kind: "session-ended" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("CSRF failure reads once and requires another explicit logout", async () => {
  fetchMock
    .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
    .mockResolvedValueOnce(json({ ...auth, csrfToken: "fresh-csrf" }));
  const result = await signOut("synthetic-csrf");
  expect(result.kind).toBe("retry");
  expect(result.kind === "retry" && result.csrfToken === "fresh-csrf").toBe(
    true,
  );
  expect(fetchMock.mock.calls.map((call) => call[0].method)).toEqual([
    "POST",
    "GET",
  ]);
});
it.each([401, 403, 500, 200])(
  "contains failed CSRF recovery %i",
  async (status) => {
    fetchMock
      .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
      .mockResolvedValueOnce(
        status === 200 ? json({}) : failure("UNAUTHENTICATED", status),
      );
    expect((await signOut("synthetic-csrf")).kind).toBe(
      status === 401 ? "session-ended" : "failure",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);
it("forbidden is authorization failure without refresh", async () => {
  fetchMock.mockResolvedValue(failure("FORBIDDEN", 403));
  expect(await signOut("synthetic-csrf")).toEqual({
    kind: "failure",
    message: "You are not authorized to perform this action.",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
