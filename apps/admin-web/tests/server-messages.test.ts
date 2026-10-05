import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { getCookie } = vi.hoisted(() => ({ getCookie: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: getCookie }) }));

import { getGuestMessages } from "../src/messages/server-messages";
import { parseMessageQuery } from "../src/messages/query";
import { failure, json } from "./fixtures";
import { messageItem, messageList } from "./message-fixtures";

const fetchMock = vi.fn();
const query = parseMessageQuery({})!;

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
  "cookie-only no-store generated message list read (%s)",
  async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    getCookie.mockReturnValue({ value: "synthetic" });
    fetchMock.mockResolvedValue(json(messageList));
    expect(await getGuestMessages(query)).toEqual({
      kind: "ready",
      data: messageList,
    });
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.url).toContain(
      "/api/admin/messages?page=1&pageSize=25&sortBy=createdAt&sortOrder=desc&hidden=all",
    );
    expect(request.cache).toBe("no-store");
    expect(request.redirect).toBe("error");
    expect([...request.headers.keys()]).toEqual(["cookie"]);
    expect(getCookie).toHaveBeenCalledWith(
      mode === "production" ? "__Host-admin_session" : "admin_session",
    );
  },
);

it("uses scoped endpoint and omits redundant invitationId query", async () => {
  fetchMock.mockResolvedValue(json(messageList));
  await getGuestMessages({
    ...query,
    invitationId: messageItem.invitation.id,
    hidden: "hidden",
  });
  const url = new URL(fetchMock.mock.calls[0]![0].url);
  expect(url.pathname).toBe(
    `/api/admin/invitations/${messageItem.invitation.id}/messages`,
  );
  expect(url.searchParams.get("hidden")).toBe("hidden");
  expect(url.searchParams.has("invitationId")).toBe(false);
});

it.each([
  [401, "unauthenticated"],
  [403, "forbidden"],
  [404, "not-found"],
  [500, "unavailable"],
] as const)("contains message read failure %s", async (status, kind) => {
  fetchMock.mockResolvedValue(failure("private", status));
  expect(await getGuestMessages(query)).toEqual({ kind });
});

it.each([
  {},
  { ...messageList, page: { ...messageList.page, totalPages: 0 } },
  { ...messageList, page: { ...messageList.page, number: 2 } },
  { ...messageList, items: [{ ...messageList.items[0], invitation: {} }] },
  { ...messageList, items: [{ ...messageList.items[0], authorName: 7 }] },
  { ...messageList, items: [{ ...messageList.items[0], hiddenAt: "secret" }] },
  { ...messageList, items: [{ ...messageList.items[0], tokenHash: "secret" }] },
])("rejects malformed message list %#", async (value) => {
  fetchMock.mockResolvedValue(json(value));
  expect(await getGuestMessages(query)).toEqual({ kind: "unavailable" });
});
