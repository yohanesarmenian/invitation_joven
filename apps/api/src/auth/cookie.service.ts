import { Injectable } from "@nestjs/common";

const PRODUCTION_COOKIE_NAME = "__Host-admin_session";
const DEVELOPMENT_COOKIE_NAME = "admin_session";

type CookieAttributes = {
  expires: Date;
  maxAge?: number;
};

@Injectable()
export class AdminCookieService {
  getCookieName(): string {
    return process.env.NODE_ENV === "production"
      ? PRODUCTION_COOKIE_NAME
      : DEVELOPMENT_COOKIE_NAME;
  }

  isSecureCookie(): boolean {
    return process.env.NODE_ENV === "production";
  }

  parseSessionCookie(cookieHeader: string | string[] | undefined): string | null {
    const cookieValue = Array.isArray(cookieHeader)
      ? cookieHeader.join(";")
      : cookieHeader;

    if (typeof cookieValue !== "string" || cookieValue.length === 0) {
      return null;
    }

    const cookieName = this.getCookieName();
    for (const part of cookieValue.split(";")) {
      const [name, ...valueParts] = part.trim().split("=");

      if (name === cookieName) {
        const value = valueParts.join("=");

        return value.length > 0 ? value : null;
      }
    }

    return null;
  }

  serializeSessionCookie(sessionToken: string, expires: Date): string {
    return this.serializeCookie(sessionToken, { expires });
  }

  serializeClearedSessionCookie(): string {
    return this.serializeCookie("", {
      expires: new Date(0),
      maxAge: 0,
    });
  }

  private serializeCookie(value: string, attributes: CookieAttributes): string {
    const parts = [
      `${this.getCookieName()}=${value}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      `Expires=${attributes.expires.toUTCString()}`,
    ];

    if (attributes.maxAge !== undefined) {
      parts.push(`Max-Age=${attributes.maxAge}`);
    }

    if (this.isSecureCookie()) {
      parts.push("Secure");
    }

    return parts.join("; ");
  }
}
