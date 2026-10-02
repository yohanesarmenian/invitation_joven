import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { getCookie } = vi.hoisted(() => ({ getCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: getCookie }) }));
import { getDashboard, isDashboard } from "../src/dashboard/server-dashboard";
import { json, failure } from "./fixtures";
const data = {
  invitations: { active: 7, archived: 2, openedActive: 5 },
  rsvp: { pending: 3, accepted: 9, declined: 4 },
  expectedByEvent: [
    {
      event: { id: "b", slug: "z", name: "Ceremony" },
      expectedAttendeeCount: 11,
    },
  ],
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ADMIN_API_INTERNAL_BASE_URL", "http://127.0.0.1:4000");
  fetchMock.mockReset();
  getCookie.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it.each(["test", "production"])(
  "uses generated GET, only %s session cookie and no-store",
  async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    getCookie.mockReturnValue({ value: "synthetic" });
    fetchMock.mockResolvedValue(json(data));
    expect(await getDashboard()).toEqual({ kind: "ready", data });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.url).toBe("http://127.0.0.1:4000/api/admin/dashboard");
    expect(request.method).toBe("GET");
    expect(request.cache).toBe("no-store");
    expect(request.redirect).toBe("error");
    expect([...request.headers.keys()]).toEqual(["cookie"]);
    expect(getCookie).toHaveBeenCalledExactlyOnceWith(
      mode === "production" ? "__Host-admin_session" : "admin_session",
    );
  },
);
it.each([
  [401, "unauthenticated"],
  [403, "forbidden"],
  [500, "unavailable"],
])("handles status %i without backend details", async (status, kind) => {
  fetchMock.mockResolvedValue(failure("private", Number(status)));
  expect(await getDashboard()).toEqual({ kind });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not forward missing cookie or arbitrary headers", async () => {
  fetchMock.mockResolvedValue(failure("UNAUTHENTICATED", 401));
  await getDashboard();
  expect([...fetchMock.mock.calls[0]![0].headers.keys()]).toEqual([]);
});
it("contains network failures", async () => {
  fetchMock.mockRejectedValue(new Error("private diagnostic"));
  expect(await getDashboard()).toEqual({ kind: "unavailable" });
});
it.each([
  null,
  {},
  { ...data, invitations: { ...data.invitations, active: -1 } },
  { ...data, rsvp: { ...data.rsvp, pending: 1.5 } },
  { ...data, expectedByEvent: [{ event: {}, expectedAttendeeCount: 1 }] },
  { ...data, rsvp: { ...data.rsvp, accepted: "9" } },
])("rejects malformed success %#", async (value) => {
  expect(isDashboard(value)).toBe(false);
  fetchMock.mockResolvedValue(json(value));
  expect(await getDashboard()).toEqual({ kind: "unavailable" });
});
it("never reuses a previous response", async () => {
  fetchMock
    .mockResolvedValueOnce(json(data))
    .mockResolvedValueOnce(failure("UNAUTHENTICATED", 401));
  expect((await getDashboard()).kind).toBe("ready");
  expect((await getDashboard()).kind).toBe("unauthenticated");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
