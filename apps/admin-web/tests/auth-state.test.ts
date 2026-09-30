import { describe, expect, it } from "vitest";
import { loginFailure, readAuth, validateLogin } from "../src/auth/auth-state";
import { auth } from "./fixtures";
describe("login validation", () => {
  it.each([14, 15, 128, 129])(
    "counts %i ASCII password code points",
    (length) => {
      expect(
        !!validateLogin("owner@example.com", "x".repeat(length)).fields
          .password,
      ).toBe(length < 15 || length > 128);
    },
  );
  it.each([14, 15, 128, 129])(
    "counts %i emoji password code points",
    (length) => {
      expect(
        !!validateLogin("owner@example.com", "💐".repeat(length)).fields
          .password,
      ).toBe(length < 15 || length > 128);
    },
  );
  it("normalizes email and preserves password whitespace", () => {
    const value = validateLogin("  OWNER@Example.COM  ", " ".repeat(15));
    expect(value.fields).toEqual({});
    expect(value.body.email).toBe("owner@example.com");
    expect(value.body.password === " ".repeat(15)).toBe(true);
  });
  it.each(["", " ", "owner", "a@b", "a b@c.com", "x".repeat(249) + "@x.com"])(
    "rejects invalid email case %#",
    (email) => {
      expect(validateLogin(email, "x".repeat(15)).fields.email).toBeDefined();
    },
  );
  it("accepts 254 email characters", () =>
    expect(
      validateLogin("x".repeat(248) + "@x.com", "x".repeat(15)).fields.email,
    ).toBeUndefined());
  it("requires password", () =>
    expect(
      validateLogin("owner@example.com", "").fields.password,
    ).toBeDefined());
  it.each([
    [401, "INVALID_CREDENTIALS", "Email or password is incorrect."],
    [
      429,
      "TOO_MANY_LOGIN_ATTEMPTS",
      "Too many sign-in attempts. Please try again later.",
    ],
    [400, "VALIDATION_ERROR", "Check your email and password, then try again."],
    [503, "INTERNAL_ERROR", "Unable to sign in. Please try again."],
  ])("maps status %i safely", (status, code, message) =>
    expect(loginFailure(Number(status), String(code))).toBe(message),
  );
});
describe("safe auth shape", () => {
  it("picks safe generated fields", () =>
    expect(readAuth({ ...auth, privateMetadata: "not-for-client" })).toEqual(
      auth,
    ));
  it.each([
    null,
    {},
    { ...auth, user: { ...auth.user, role: "GUEST" } },
    { ...auth, user: { ...auth.user, id: 1 } },
    { ...auth, user: { ...auth.user, email: null } },
    { ...auth, session: {} },
    { ...auth, csrfToken: null },
  ])("fails closed for malformed case %#", (value) =>
    expect(readAuth(value)).toBeNull(),
  );
});
