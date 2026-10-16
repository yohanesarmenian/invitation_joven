import { Injectable } from "@nestjs/common";
import { isLoopbackDevelopmentOrigin } from "../security/development-origin.js";

@Injectable()
export class PublicInvitationBaseUrlService {
  getBaseOrigin(): string {
    const value = process.env.PUBLIC_INVITATION_BASE_URL;

    if (value === undefined) {
      throw new Error("PUBLIC_INVITATION_BASE_URL is required.");
    }

    const url = new URL(value);

    if (
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.hostname.includes("*")
    ) {
      throw new Error("PUBLIC_INVITATION_BASE_URL must be an exact origin.");
    }

    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("Production PUBLIC_INVITATION_BASE_URL must use HTTPS.");
    }

    if (url.protocol !== "https:" && !isLoopbackDevelopmentOrigin(url)) {
      throw new Error(
        "PUBLIC_INVITATION_BASE_URL must be HTTPS outside local development.",
      );
    }

    return url.origin;
  }

  buildInvitationUrl(publicCredential: string): string {
    return `${this.getBaseOrigin()}/i/${publicCredential}`;
  }
}
