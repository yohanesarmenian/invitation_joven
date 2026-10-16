import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOriginService } from "./admin-origin.service.js";

describe("AdminOriginService", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows isolated loopback development ports but still requires the exact request origin", () => {
    vi.stubEnv("NODE_ENV", "test");
    const service = new AdminOriginService();
    for (const origin of [
      "http://localhost:3101",
      "http://127.0.0.1:3101",
      "http://[::1]:3101",
    ]) {
      vi.stubEnv("ADMIN_ORIGIN", origin);
      expect(service.getExpectedOrigin()).toBe(origin);
      expect(() => service.assertValidAdminOrigin({ origin })).not.toThrow();
      expect(() =>
        service.assertValidAdminOrigin({ origin: "http://localhost:3001" }),
      ).toThrow();
    }
    for (const origin of [
      "http://localhost.evil.test:3101",
      "http://192.168.1.2:3101",
      "ftp://localhost:3101",
    ]) {
      vi.stubEnv("ADMIN_ORIGIN", origin);
      expect(() => service.getExpectedOrigin()).toThrow();
    }
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_ORIGIN", "http://localhost:3101");
    expect(() => service.getExpectedOrigin()).toThrow(
      "Production ADMIN_ORIGIN must use HTTPS.",
    );
  });
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
      service.assertValidAdminOrigin({
        origin: "http://localhost:3001.evil.test",
      }),
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
