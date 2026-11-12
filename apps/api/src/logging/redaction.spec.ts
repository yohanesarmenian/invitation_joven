import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  REDACTION_CENSOR,
  pinoRedactOptions,
  sanitizeRequestUrl,
  serializeRequestForLogging,
} from "./redaction.js";

function createCollectingStream(lines: string[]) {
  return new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
}

describe("logging redaction", () => {
  it("redacts sensitive structured fields in observable Pino output", async () => {
    const lines: string[] = [];
    const logger = pino(
      {
        redact: pinoRedactOptions,
      },
      createCollectingStream(lines),
    );

    logger.info({
      password: "plain-password",
      passwordHash: "argon2-secret",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      req: {
        headers: {
          authorization: "Bearer public-secret",
          cookie: "admin_session=secret",
          "set-cookie": "admin_session=secret; HttpOnly",
        },
      },
      res: {
        headers: {
          "set-cookie": "csrf=secret; HttpOnly",
        },
      },
      nested: {
        qrPayload: "qr-secret",
        sessionToken: "session-secret",
        sessionTokenHash: "session-hash-secret",
        csrfToken: "csrf-secret",
        csrfTokenHash: "csrf-hash-secret",
        invitationToken: "invitation-secret",
        invitationTokenHash: "hash-secret",
        checkinToken: "checkin-secret",
        checkinTokenHash: "checkin-hash-secret",
        credentialSecret: "hmac-secret",
      },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    const line = lines.join("");
    const parsed = JSON.parse(line) as {
      password: string;
      passwordHash: string;
      DATABASE_URL: string;
      req: {
        headers: {
          authorization: string;
          cookie: string;
          "set-cookie": string;
        };
      };
      res: { headers: { "set-cookie": string } };
      nested: {
        qrPayload: string;
        sessionToken: string;
        sessionTokenHash: string;
        csrfToken: string;
        csrfTokenHash: string;
        invitationToken: string;
        invitationTokenHash: string;
        checkinToken: string;
        checkinTokenHash: string;
        credentialSecret: string;
      };
    };

    expect(parsed.password).toBe(REDACTION_CENSOR);
    expect(parsed.passwordHash).toBe(REDACTION_CENSOR);
    expect(parsed.DATABASE_URL).toBe(REDACTION_CENSOR);
    expect(parsed.req.headers.authorization).toBe(REDACTION_CENSOR);
    expect(parsed.req.headers.cookie).toBe(REDACTION_CENSOR);
    expect(parsed.req.headers["set-cookie"]).toBe(REDACTION_CENSOR);
    expect(parsed.res.headers["set-cookie"]).toBe(REDACTION_CENSOR);
    expect(parsed.nested.qrPayload).toBe(REDACTION_CENSOR);
    expect(parsed.nested.sessionToken).toBe(REDACTION_CENSOR);
    expect(parsed.nested.sessionTokenHash).toBe(REDACTION_CENSOR);
    expect(parsed.nested.csrfToken).toBe(REDACTION_CENSOR);
    expect(parsed.nested.csrfTokenHash).toBe(REDACTION_CENSOR);
    expect(parsed.nested.invitationToken).toBe(REDACTION_CENSOR);
    expect(parsed.nested.invitationTokenHash).toBe(REDACTION_CENSOR);
    expect(parsed.nested.checkinToken).toBe(REDACTION_CENSOR);
    expect(parsed.nested.checkinTokenHash).toBe(REDACTION_CENSOR);
    expect(parsed.nested.credentialSecret).toBe(REDACTION_CENSOR);
    expect(line).not.toContain("plain-password");
    expect(line).not.toContain("argon2-secret");
    expect(line).not.toContain("public-secret");
    expect(line).not.toContain("qr-secret");
    expect(line).not.toContain("session-secret");
    expect(line).not.toContain("csrf-secret");
    expect(line).not.toContain("invitation-secret");
    expect(line).not.toContain("checkin-secret");
    expect(line).not.toContain("hmac-secret");
  });

  it("sanitizes bearer credential URL paths before request logging", () => {
    expect(
      sanitizeRequestUrl(
        "/api/admin/reception/search?query=Synthetic%20Household&page=1",
      ),
    ).toBe(
      `/api/admin/reception/search?query=${encodeURIComponent(REDACTION_CENSOR)}&page=1`,
    );
    expect(
      sanitizeRequestUrl(
        "/api/public/invitations/raw-invitation-credential/rsvp?token=raw-query-token&page=1",
      ),
    ).toBe(
      `/api/public/invitations/${REDACTION_CENSOR}/rsvp?token=${encodeURIComponent(
        REDACTION_CENSOR,
      )}&page=1`,
    );

    expect(
      serializeRequestForLogging({
        id: "req-12345678",
        method: "GET",
        url: "/api/public/checkin/raw-checkin-credential",
      }),
    ).toMatchObject({
      id: "req-12345678",
      method: "GET",
      url: `/api/public/checkin/${REDACTION_CENSOR}`,
    });

    expect(sanitizeRequestUrl("/i/raw-invitation-credential")).toBe(
      `/i/${REDACTION_CENSOR}`,
    );
    expect(sanitizeRequestUrl("/c/raw-checkin-credential")).toBe(
      `/c/${REDACTION_CENSOR}`,
    );
    expect(
      sanitizeRequestUrl(
        "/admin/path?credential=raw-credential&qrPayload=raw-qr&safe=1",
      ),
    ).toBe(
      `/admin/path?credential=${encodeURIComponent(
        REDACTION_CENSOR,
      )}&qrPayload=${encodeURIComponent(REDACTION_CENSOR)}&safe=1`,
    );
  });
});
