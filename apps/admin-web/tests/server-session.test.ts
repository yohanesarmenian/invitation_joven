import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { getCookie } = vi.hoisted(() => ({ getCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: getCookie }) }));
import { getServerSession } from "../src/auth/server-session";
import { getAdminApiBaseUrl } from "../src/auth/api-config";
import { auth, failure, json } from "./fixtures";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ADMIN_API_INTERNAL_BASE_URL", "http://127.0.0.1:4000");
  getCookie.mockReset();
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("server session", () => {
  it.each(["test", "development", "production"])(
    "forwards only the %s session cookie with no caching",
    async (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      getCookie.mockReturnValue({ value: "synthetic-cookie" });
      fetchMock.mockResolvedValue(json(auth));
      expect(await getServerSession()).toEqual({ kind: "authenticated", auth });
      const name =
        mode === "production" ? "__Host-admin_session" : "admin_session";
      expect(getCookie).toHaveBeenCalledExactlyOnceWith(name);
      const request = fetchMock.mock.calls[0]![0] as Request;
      expect(request.url).toBe("http://127.0.0.1:4000/api/admin/auth/me");
      expect([...request.headers.keys()]).toEqual(["cookie"]);
      expect(request.headers.get("cookie") === `${name}=synthetic-cookie`).toBe(
        true,
      );
      expect(request.cache).toBe("no-store");
      expect(request.redirect).toBe("error");
    },
  );
  it("calls without headers when cookie is missing", async () => {
    fetchMock.mockResolvedValue(failure("UNAUTHENTICATED", 401));
    expect(await getServerSession()).toEqual({ kind: "unauthenticated" });
    expect([...fetchMock.mock.calls[0]![0].headers.keys()]).toEqual([]);
  });
  it.each([{}, { ...auth, csrfToken: null }])(
    "fails closed on malformed success %#",
    async (value) => {
      fetchMock.mockResolvedValue(json(value));
      expect(await getServerSession()).toEqual({ kind: "unavailable" });
    },
  );
  it("maps forbidden safely", async () => {
    fetchMock.mockResolvedValue(failure("FORBIDDEN", 403));
    expect(await getServerSession()).toEqual({ kind: "forbidden" });
  });
  it("contains network failure", async () => {
    fetchMock.mockRejectedValue(new Error("private diagnostic"));
    expect(await getServerSession()).toEqual({ kind: "unavailable" });
  });
  it("does not reuse one request's session", async () => {
    fetchMock
      .mockResolvedValueOnce(json(auth))
      .mockResolvedValueOnce(failure("UNAUTHENTICATED", 401));
    expect((await getServerSession()).kind).toBe("authenticated");
    expect((await getServerSession()).kind).toBe("unauthenticated");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([
    "ftp://localhost",
    "http://user:password@localhost",
    "http://localhost/api",
    "http://localhost?target=elsewhere",
  ])("rejects unsafe upstream config %#", (value) => {
    vi.stubEnv("ADMIN_API_INTERNAL_BASE_URL", value);
    expect(() => getAdminApiBaseUrl()).toThrow(
      "Admin API upstream must be an HTTP(S) origin.",
    );
  });
});
