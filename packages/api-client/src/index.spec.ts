import { describe, expect, it } from "vitest";
import type { components, paths } from "./generated/schema.js";
import { createInvitationApiClient } from "./index.js";

function assertApiPath(path: keyof paths): keyof paths {
  return path;
}

describe("generated API client", () => {
  it("exposes the public invitation retrieval operation and response schema", () => {
    expect(assertApiPath("/api/public/invitations/{publicCredential}")).toBe(
      "/api/public/invitations/{publicCredential}",
    );

    const response: components["schemas"]["PublicInvitationResponseDto"] = {
      invitation: {
        displayName: "Example Household",
        events: [],
        greetingName: null,
        invitees: [],
        rsvp: null,
        rsvpDeadlineAt: null,
        rules: {
          allowPlusOne: false,
          maxAdditionalChildren: 0,
        },
      },
    };
    const client = createInvitationApiClient({
      baseUrl: "https://example.test",
    });

    expect(response.invitation.rsvp).toBeNull();
    expect(typeof client.GET).toBe("function");
  });
});
