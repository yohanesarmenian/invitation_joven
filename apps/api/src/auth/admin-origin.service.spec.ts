import { describe, expect, it } from "vitest";
import { AdminOriginService } from "./admin-origin.service.js";

describe("AdminOriginService", () => {
  it("accepts exact Origin or Referer matches", () => {
    process.env.ADMIN_ORIGIN = "http://localhost:3001";
    const service = new AdminOriginService();

    expect(() =>
      service.assertValidAdminOrigin({ origin: "http://localhost:3001" }),
    ).not.toThrow();
    expect(() =>
      service.assertValidAdminOrigin({
        referer: "http://localhost:3001/admin",
      }),
    ).not.toThrow();
  });

  it("rejects absent, suffix, path, wildcard, and credential-bearing origins", () => {
    process.env.ADMIN_ORIGIN = "http://localhost:3001";
    const service = new AdminOriginService();

    expect(() => service.assertValidAdminOrigin({})).toThrow();
    expect(() =>
      service.assertValidAdminOrigin({ origin: "http://evil-localhost:3001" }),
    ).toThrow();
    expect(() =>
      service.assertValidAdminOrigin({ origin: "http://localhost:3001.evil.test" }),
    ).toThrow();

    process.env.ADMIN_ORIGIN = "http://localhost:3001/path";
    expect(() => service.getExpectedOrigin()).toThrow(
      "ADMIN_ORIGIN must be an exact origin.",
    );

    process.env.ADMIN_ORIGIN = "http://user:pass@localhost:3001";
    expect(() => service.getExpectedOrigin()).toThrow(
      "ADMIN_ORIGIN must be an exact origin.",
    );
  });

  it("requires HTTPS production origins", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.ADMIN_ORIGIN = "http://localhost:3001";

    expect(() => new AdminOriginService().getExpectedOrigin()).toThrow(
      "Production ADMIN_ORIGIN must use HTTPS.",
    );

    process.env.NODE_ENV = originalNodeEnv;
  });
});
