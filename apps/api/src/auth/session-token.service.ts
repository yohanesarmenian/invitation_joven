import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";

const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_TEXT_LENGTH = 43;
export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const CSRF_CONTEXT = "admin-csrf-v1";

export type GeneratedAdminSessionTokens = {
  rawSessionTokenBytes: Buffer;
  sessionToken: string;
  sessionTokenHash: string;
  csrfToken: string;
  csrfTokenHash: string;
};

@Injectable()
export class AdminSessionTokenService {
  generateSessionTokens(): GeneratedAdminSessionTokens {
    const rawSessionTokenBytes = randomBytes(SESSION_TOKEN_BYTES);
    const sessionToken = rawSessionTokenBytes.toString("base64url");
    const csrfToken = this.deriveCsrfToken(rawSessionTokenBytes);

    return {
      rawSessionTokenBytes,
      sessionToken,
      sessionTokenHash: this.hashSessionTokenBytes(rawSessionTokenBytes),
      csrfToken,
      csrfTokenHash: this.hashCsrfToken(csrfToken),
    };
  }

  parseSessionToken(sessionToken: string): Buffer | null {
    if (!SESSION_TOKEN_PATTERN.test(sessionToken)) {
      return null;
    }

    const rawSessionTokenBytes = Buffer.from(sessionToken, "base64url");

    return rawSessionTokenBytes.length === SESSION_TOKEN_BYTES
      ? rawSessionTokenBytes
      : null;
  }

  hashSessionTokenBytes(rawSessionTokenBytes: Buffer): string {
    return createHash("sha256").update(rawSessionTokenBytes).digest("hex");
  }

  deriveCsrfToken(rawSessionTokenBytes: Buffer): string {
    return createHmac("sha256", rawSessionTokenBytes)
      .update(CSRF_CONTEXT, "utf8")
      .digest("base64url");
  }

  hashCsrfToken(csrfToken: string): string {
    return createHash("sha256").update(csrfToken, "utf8").digest("hex");
  }

  csrfTokenHashMatches(actualHash: string | null, csrfToken: string): boolean {
    if (actualHash === null) {
      return false;
    }

    const expectedHash = this.hashCsrfToken(csrfToken);
    const actual = Buffer.from(actualHash, "utf8");
    const expected = Buffer.from(expectedHash, "utf8");

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
