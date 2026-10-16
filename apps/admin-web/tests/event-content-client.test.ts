import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "./fixtures";
import { hide, read, save, upload } from "../src/event-content/client";
const eventId = "22222222-2222-4222-8222-222222222222";
const draft = { parking: null, rundown: null };
const state = {
  eventId,
  eventName: "Reception",
  version: 1,
  draft,
  published: null,
  publishedAt: null,
  assets: [],
};
const NativeRequest = globalThis.Request;
beforeEach(() => {
  // Browser Request resolves relative same-origin paths; Node needs an explicit base.
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
describe("event-content browser transport", () => {
  it("uses generated same-origin no-store operations and verifies response shape", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.credentials).toBe("same-origin");
      expect(request.cache).toBe("no-store");
      expect(request.redirect).toBe("error");
      expect(request.url).toContain(`/api/admin/event-content/${eventId}`);
      return Response.json(state);
    });
    vi.stubGlobal("fetch", fetch);
    expect(await read(eventId)).toEqual({ kind: "ok", data: state });
  });
  it.each(["network", "malformed", "server-error"])(
    "never replays an uncertain mutation: %s",
    async (mode) => {
      const fetch = vi.fn(async () => {
        if (mode === "network") throw new Error("private backend diagnostic");
        return Response.json(
          mode === "malformed" ? { version: 1 } : { error: {} },
          { status: mode === "server-error" ? 500 : 200 },
        );
      });
      vi.stubGlobal("fetch", fetch);
      expect(await save(eventId, 0, draft, "csrf")).toEqual({
        kind: "uncertain",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("refreshes CSRF after explicit rejection without replaying the hide action", async () => {
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (request: Request) => {
      methods.push(request.method);
      return request.method === "POST"
        ? Response.json({ error: { code: "CSRF_INVALID" } }, { status: 403 })
        : Response.json(auth);
    });
    expect(await hide(eventId, 1, "old-csrf")).toEqual({
      kind: "error",
      code: "CSRF_INVALID",
      csrfToken: auth.csrfToken,
    });
    expect(methods).toEqual(["POST", "GET"]);
  });
  it("uploads actual multipart bytes, not a JSON filename descriptor", async () => {
    vi.stubGlobal("fetch", async (request: Request) => {
      expect(request.headers.get("content-type")).toContain(
        "multipart/form-data",
      );
      const form = await request.formData(),
        file = form.get("file") as File;
      expect(file.name).toBe("map.png");
      expect(await file.text()).toBe("synthetic file bytes");
      return Response.json(state);
    });
    expect(
      (
        await upload(
          eventId,
          0,
          new File(["synthetic file bytes"], "map.png", { type: "image/png" }),
          "csrf",
        )
      ).kind,
    ).toBe("ok");
  });
});
