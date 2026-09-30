import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CSRF_CONTEXT,
  SESSION_TOKEN_PATTERN,
  SESSION_TOKEN_TEXT_LENGTH,
  AdminSessionTokenService,
} from "./session-token.service.js";

describe("AdminSessionTokenService", () => {
  it("generates unique 32-byte unpadded Base64URL session tokens", () => {
    const service = new AdminSessionTokenService();
    const first = service.generateSessionTokens();
    const second = service.generateSessionTokens();

    expect(first.sessionToken).toMatch(SESSION_TOKEN_PATTERN);
    expect(first.sessionToken).toHaveLength(SESSION_TOKEN_TEXT_LENGTH);
    expect(first.sessionToken).not.toBe(second.sessionToken);
    expect(first.sessionTokenHash).not.toBe(second.sessionTokenHash);
    expect(first.csrfToken).not.toBe(second.csrfToken);
    expect(first.csrfTokenHash).not.toBe(second.csrfTokenHash);
    expect(service.parseSessionToken(first.sessionToken)).toHaveLength(32);
  });

  it("hashes the raw session token bytes and encoded CSRF token", () => {
    const service = new AdminSessionTokenService();
    const tokens = service.generateSessionTokens();

    expect(tokens.sessionTokenHash).toBe(
      createHash("sha256").update(tokens.rawSessionTokenBytes).digest("hex"),
    );
    expect(tokens.csrfTokenHash).toBe(
      createHash("sha256").update(tokens.csrfToken, "utf8").digest("hex"),
    );
  });

  it("matches the CSRF golden vector with session bytes as HMAC key", () => {
    const service = new AdminSessionTokenService();
    const rawSessionTokenBytes = Buffer.from(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      "hex",
    );
    const expected = createHmac("sha256", rawSessionTokenBytes)
      .update(CSRF_CONTEXT, "utf8")
      .digest("base64url");

    expect(service.deriveCsrfToken(rawSessionTokenBytes)).toBe(expected);
  });
});
