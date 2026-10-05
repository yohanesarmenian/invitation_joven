import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { getCookie } = vi.hoisted(() => ({ getCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: getCookie }) }));

import { getRsvpDetail, getRsvpEvents, getRsvps } from "../src/rsvps/server-rsvps";
import { parseRsvpQuery } from "../src/rsvps/query";
import { failure, json } from "./fixtures";
import { rsvpDetail, rsvpEvents, rsvpList } from "./rsvp-fixtures";

const fetchMock = vi.fn();
const query = parseRsvpQuery({})!;

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
  "cookie-only no-store generated RSVP list read (%s)",
  async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    getCookie.mockReturnValue({ value: "synthetic" });
    fetchMock.mockResolvedValue(json(rsvpList));
    expect(await getRsvps(query)).toEqual({ kind: "ready", data: rsvpList });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.url).toContain(
      "/api/admin/rsvps?page=1&pageSize=25&sortBy=updatedAt&sortOrder=desc",
    );
    expect(request.cache).toBe("no-store");
    expect(request.redirect).toBe("error");
    expect([...request.headers.keys()]).toEqual(["cookie"]);
    expect(getCookie).toHaveBeenCalledWith(
      mode === "production" ? "__Host-admin_session" : "admin_session",
    );
  },
);

it("forwards only normalized supported RSVP queries", async () => {
  fetchMock.mockResolvedValue(json(rsvpList));
  await getRsvps({
    ...query,
    search: "Twin",
    status: "ACCEPTED",
    eventId: rsvpEvents[0]!.id,
  });
  const url = new URL(fetchMock.mock.calls[0]![0].url);
  expect(url.searchParams.get("search")).toBe("Twin");
  expect(url.searchParams.get("status")).toBe("ACCEPTED");
  expect(url.searchParams.get("eventId")).toBe(rsvpEvents[0]!.id);
  expect([...fetchMock.mock.calls[0]![0].headers.keys()]).toEqual([]);
});

it.each([getRsvpEvents, () => getRsvps(query), () => getRsvpDetail(rsvpDetail.rsvp.id)])(
  "contains read failures %#",
  async (read) => {
    for (const [status, kind] of [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [500, "unavailable"],
    ] as const) {
      fetchMock.mockResolvedValue(failure("private", status));
      expect(await read()).toEqual({ kind });
    }
    fetchMock.mockRejectedValue(new Error("private"));
    expect(await read()).toEqual({ kind: "unavailable" });
  },
);

it.each([
  {},
  { ...rsvpList, page: { ...rsvpList.page, totalPages: 0 } },
  { ...rsvpList, page: { ...rsvpList.page, number: 2 } },
  { ...rsvpList, items: [{ ...rsvpList.items[0], status: "unknown" }] },
  { ...rsvpList, items: [{ ...rsvpList.items[0], attendeeCount: -1 }] },
  { ...rsvpList, items: [{ ...rsvpList.items[0], dietaryNotes: "private" }] },
  { ...rsvpList, items: [{ ...rsvpList.items[0], qrPayload: "secret" }] },
])("rejects malformed RSVP list %#", async (value) => {
  fetchMock.mockResolvedValue(json(value));
  expect(await getRsvps(query)).toEqual({ kind: "unavailable" });
});

it("accepts detail safe metadata and rejects sensitive leakage", async () => {
  fetchMock.mockResolvedValue(json(rsvpDetail));
  expect(await getRsvpDetail(rsvpDetail.rsvp.id)).toEqual({
    kind: "ready",
    data: rsvpDetail,
  });
  fetchMock.mockResolvedValue(
    json({ rsvp: { ...rsvpDetail.rsvp, checkinPasses: [{ qrPayload: "x" }] } }),
  );
  expect(await getRsvpDetail(rsvpDetail.rsvp.id)).toEqual({
    kind: "unavailable",
  });
});

it("rejects invalid RSVP detail ids before calling the backend", async () => {
  expect(await getRsvpDetail("not-a-uuid")).toEqual({ kind: "not-found" });
  expect(fetchMock).not.toHaveBeenCalled();
});
