import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "./fixtures";
import {
  save,
  list,
  fromWib,
  toWib,
  type EventFields,
} from "../src/events/client";
const fields: EventFields = {
  name: "Synthetic event",
  slug: "synthetic-event",
  description: null,
  startsAt: null,
  endsAt: null,
  venueName: null,
  address: null,
  googleMapsUrl: null,
  displayOrder: 1,
  isActive: true,
};
const row = {
  ...fields,
  id: "22222222-2222-4222-8222-222222222222",
  version: 3,
  usage: { invitations: 0, rsvps: 0, checkins: 0 },
};
const NativeRequest = globalThis.Request;
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
});
afterEach(() => vi.unstubAllGlobals());
describe("event management client recovery", () => {
  it.each(["network", "malformed", "server-error"])(
    "does not replay an uncertain save: %s",
    async (mode) => {
      const fetch = vi.fn(async () => {
        if (mode === "network") throw Error("private diagnostic");
        return Response.json(
          mode === "malformed" ? { ...row, usage: null } : {},
          { status: mode === "server-error" ? 500 : 200 },
        );
      });
      vi.stubGlobal("fetch", fetch);
      expect(await save(fields, "csrf", row)).toEqual({ kind: "uncertain" });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("refreshes rejected CSRF without replaying and preserves the known error code", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      methods.push(request.method);
      return request.method === "GET"
        ? Response.json(auth)
        : Response.json({ error: { code: "CSRF_INVALID" } }, { status: 403 });
    });
    expect(await save(fields, "old-csrf", row)).toEqual({
      kind: "error",
      code: "CSRF_INVALID",
      csrfToken: auth.csrfToken,
    });
    expect(methods).toEqual(["PUT", "GET"]);
  });
  it("uses same-origin no-store requests and sends only editable fields plus version", async () => {
    vi.stubGlobal("fetch", async (request: Request) => {
      expect(request.cache).toBe("no-store");
      expect(request.credentials).toBe("same-origin");
      expect(request.redirect).toBe("error");
      if (request.method === "PUT") {
        expect(await request.json()).toEqual({ ...fields, expectedVersion: 3 });
        return Response.json(row);
      }
      return Response.json({ items: [row] });
    });
    expect((await list()).kind).toBe("ok");
    expect((await save(fields, "csrf", row)).kind).toBe("ok");
  });
  it("converts WIB independently of host timezone without losing seconds or milliseconds", () => {
    expect(toWib("2028-02-10T17:30:15.123Z")).toBe("2028-02-11T00:30:15.123");
    expect(new Date(fromWib("2028-02-11T00:30:15.123")!).toISOString()).toBe(
      "2028-02-10T17:30:15.123Z",
    );
    expect(fromWib("")).toBeNull();
    expect(toWib(null)).toBe("");
  });
});
