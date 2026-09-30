import { describe, expect, it } from "vitest";
import { normalizeAdminEmail, validateAdminPassword } from "./admin-credentials.js";

function expectValidationError(action: () => unknown) {
  expect(action).toThrow(expect.objectContaining({ name: "BadRequestException" }));
}

describe("admin credentials", () => {
  it("normalizes email consistently", () => {
    expect(normalizeAdminEmail("  OWNER@Example.COM  ")).toBe(
      "owner@example.com",
    );
  });

  it("validates email syntax and length", () => {
    expectValidationError(() => normalizeAdminEmail("not-an-email"));
    expectValidationError(() =>
      normalizeAdminEmail(`${"a".repeat(245)}@example.com`),
    );
  });

  it("validates password using Unicode code points without trimming", () => {
    expect(validateAdminPassword(" password with spaces ")).toBe(
      " password with spaces ",
    );
    expect(validateAdminPassword("🙂".repeat(15))).toBe("🙂".repeat(15));
    expect(validateAdminPassword("a".repeat(128))).toHaveLength(128);
    expectValidationError(() => validateAdminPassword("a".repeat(14)));
    expectValidationError(() => validateAdminPassword("🙂".repeat(129)));
  });
});
