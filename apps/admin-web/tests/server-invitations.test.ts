import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { getCookie } = vi.hoisted(() => ({ getCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: getCookie }) }));
import {
  getEvents,
  getInvitations,
} from "../src/invitations/server-invitations";
import { parseInvitationQuery } from "../src/invitations/query";
import { list, events } from "./invitation-fixtures";
import { failure, json } from "./fixtures";
const fetchMock = vi.fn(),
  query = parseInvitationQuery({})!;
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
  "cookie-only no-store generated list read (%s)",
  async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    getCookie.mockReturnValue({ value: "synthetic" });
    fetchMock.mockResolvedValue(json(list));
    expect(await getInvitations(query)).toEqual({ kind: "ready", data: list });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.url).toContain(
      "/api/admin/invitations?page=1&pageSize=25&sortBy=createdAt&sortOrder=desc",
    );
    expect(request.cache).toBe("no-store");
    expect(request.redirect).toBe("error");
    expect([...request.headers.keys()]).toEqual(["cookie"]);
    expect(getCookie).toHaveBeenCalledWith(
      mode === "production" ? "__Host-admin_session" : "admin_session",
    );
  },
);
it("forwards only normalized supported queries", async () => {
  fetchMock.mockResolvedValue(json(list));
  await getInvitations({
    ...query,
    search: "Twin",
    status: "ACTIVE",
    rsvpStatus: "PENDING",
  });
  const url = new URL(fetchMock.mock.calls[0]![0].url);
  expect(url.searchParams.get("search")).toBe("Twin");
  expect(url.searchParams.get("rsvpStatus")).toBe("PENDING");
  expect([...fetchMock.mock.calls[0]![0].headers.keys()]).toEqual([]);
});
it.each([getEvents, () => getInvitations(query)])(
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
  { ...list, page: { ...list.page, totalPages: 0 } },
  { ...list, page: { ...list.page, number: 2 } },
  { ...list, items: [{ ...list.items[0], rsvpStatus: "unknown" }] },
  { ...list, items: [{ ...list.items[0], status: ["ACTIVE"] }] },
  { ...list, items: [{ ...list.items[0], rsvpStatus: ["PENDING"] }] },
  { ...list, items: [{ ...list.items[0], openCount: -1 }] },
  { ...list, items: [{ ...list.items[0], lastOpenedAt: "bad" }] },
])("rejects malformed list %#", async (value) => {
  fetchMock.mockResolvedValue(json(value));
  expect(await getInvitations(query)).toEqual({ kind: "unavailable" });
});
it("accepts legitimate empty/out-of-range metadata without changing page", async () => {
  fetchMock.mockResolvedValue(
    json({
      items: [],
      page: { number: 5, pageSize: 25, totalItems: 1, totalPages: 1 },
    }),
  );
  expect((await getInvitations({ ...query, page: 5 })).kind).toBe("ready");
  fetchMock.mockResolvedValue(
    json({
      items: [],
      page: { number: 1, pageSize: 25, totalItems: 0, totalPages: 0 },
    }),
  );
  expect((await getInvitations(query)).kind).toBe("ready");
});
it("preserves real event order and inactive state, projects only catalog fields", async () => {
  fetchMock.mockResolvedValue(
    json({
      events: events.map((event) => ({ ...event, private: "not projected" })),
    }),
  );
  expect(await getEvents()).toEqual({ kind: "ready", data: { events } });
  expect(fetchMock.mock.calls[0]![0].url).toBe(
    "http://127.0.0.1:4000/api/admin/events",
  );
});
it("rejects malformed event data", async () => {
  fetchMock.mockResolvedValue(
    json({ events: [{ ...events[0], isActive: "true" }] }),
  );
  expect(await getEvents()).toEqual({ kind: "unavailable" });
});
