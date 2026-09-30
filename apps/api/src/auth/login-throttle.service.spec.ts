import { describe, expect, it } from "vitest";
import { LoginThrottleService } from "./login-throttle.service.js";

describe("LoginThrottleService", () => {
  let currentTime = new Date("2026-09-30T00:00:00.000Z");

  function service() {
    return new LoginThrottleService(() => currentTime);
  }

  it("rejects the eleventh failed attempt for one normalized email", () => {
    const throttle = service();

    for (let i = 0; i < 10; i += 1) {
      expect(() => throttle.assertAllowed("owner@example.com")).not.toThrow();
      throttle.recordFailure("owner@example.com");
    }

    expect(() => throttle.assertAllowed("owner@example.com")).toThrow(
      expect.objectContaining({ name: "HttpException" }),
    );
  });

  it("rejects after the process-wide failure threshold and resets after the window", () => {
    const throttle = service();

    for (let i = 0; i < 100; i += 1) {
      throttle.recordFailure(`unknown-${i}@example.com`);
    }

    expect(() => throttle.assertAllowed("new@example.com")).toThrow();
    currentTime = new Date(currentTime.getTime() + 15 * 60 * 1000 + 1);
    expect(() => throttle.assertAllowed("new@example.com")).not.toThrow();
  });

  it("successful login clears only the email failure bucket", () => {
    const throttle = service();

    throttle.recordFailure("owner@example.com");
    throttle.recordFailure("other@example.com");
    throttle.recordSuccess("owner@example.com");

    expect(() => throttle.assertAllowed("owner@example.com")).not.toThrow();
    expect(() => throttle.assertAllowed("other@example.com")).not.toThrow();
  });
});
