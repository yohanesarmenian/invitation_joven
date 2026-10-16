import { Injectable } from "@nestjs/common";
import { csrfInvalid } from "./auth-errors.js";
import { isLoopbackDevelopmentOrigin } from "../security/development-origin.js";

type HeaderValue = string | string[] | undefined;
type HeaderBag = Record<string, HeaderValue>;

function getHeader(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);

    return url.origin;
  } catch {
    return null;
  }
}

@Injectable()
export class AdminOriginService {
  getExpectedOrigin(): string {
    const value = process.env.ADMIN_ORIGIN;

    if (value === undefined) {
      throw new Error("ADMIN_ORIGIN is required.");
    }

    const url = new URL(value);

    if (
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("ADMIN_ORIGIN must be an exact origin.");
    }

    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("Production ADMIN_ORIGIN must use HTTPS.");
    }

    if (url.protocol !== "https:" && !isLoopbackDevelopmentOrigin(url)) {
      throw new Error("ADMIN_ORIGIN must be HTTPS outside local development.");
    }

    return url.origin;
  }

  assertValidAdminOrigin(headers: HeaderBag): void {
    const expectedOrigin = this.getExpectedOrigin();
    const origin = getHeader(headers, "origin");

    if (origin !== undefined) {
      if (parseOrigin(origin) === expectedOrigin) {
        return;
      }

      csrfInvalid();
    }

    const referer = getHeader(headers, "referer");

    if (referer !== undefined && parseOrigin(referer) === expectedOrigin) {
      return;
    }

    csrfInvalid();
  }
}
