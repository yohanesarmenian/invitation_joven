import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { moderateGuestMessage } from "../src/messages/moderation";
import { auth, failure, json } from "./fixtures";
import { messageItem } from "./message-fixtures";

const NativeRequest = Request;
const fetchMock = vi.fn();

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

it("sends one generated PATCH with exact visibility body and CSRF", async () => {
  fetchMock.mockResolvedValue(json({ ...messageItem, isHidden: true }));
  expect(
    await moderateGuestMessage(messageItem.id, { isHidden: true }, "csrf-token"),
  ).toMatchObject({ kind: "updated" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const req = fetchMock.mock.calls[0]![0] as Request;
  expect(req.method).toBe("PATCH");
  expect(req.url).toBe(`http://localhost:3001/api/admin/messages/${messageItem.id}`);
  expect(req.headers.get("x-csrf-token")).toBe("csrf-token");
  expect(req.headers.has("idempotency-key")).toBe(false);
  expect(await req.json()).toEqual({ isHidden: true });
});

it("maps validation, not found, uncertain outcomes, and CSRF without replay", async () => {
  fetchMock.mockResolvedValueOnce(failure("VALIDATION_ERROR", 400));
  expect(await moderateGuestMessage(messageItem.id, { isHidden: true }, "csrf")).toEqual({
    kind: "validation",
  });
  fetchMock.mockResolvedValueOnce(failure("NOT_FOUND", 404));
  expect(await moderateGuestMessage(messageItem.id, { isHidden: true }, "csrf")).toEqual({
    kind: "not-found",
  });
  fetchMock.mockResolvedValueOnce(failure("INTERNAL_ERROR", 500));
  expect(await moderateGuestMessage(messageItem.id, { isHidden: true }, "csrf")).toEqual({
    kind: "uncertain",
  });
  fetchMock
    .mockResolvedValueOnce(failure("CSRF_INVALID", 403))
    .mockResolvedValueOnce(json(auth));
  expect(
    await moderateGuestMessage(messageItem.id, { isHidden: true }, "old"),
  ).toMatchObject({ kind: "csrf", csrfToken: auth.csrfToken });
  expect(fetchMock.mock.calls.map((call) => call[0].method)).toEqual([
    "PATCH",
    "PATCH",
    "PATCH",
    "PATCH",
    "GET",
  ]);
});
