import { describe, expect, it } from "vitest";
import type { components, paths } from "./generated/schema.js";
import {
  createInvitationApiClient,
  type AdminAuthResponse,
  type AdminDashboardResponse,
  type ArchiveAdminInvitationResponse,
  type CreateAdminInvitationRequest,
  type CreateAdminInvitationResponse,
  type AdminInvitationDetailResponse,
  type AdminInvitationListResponse,
  type AdminInvitationPublicUrlResponse,
  type AdminLoginRequest,
  type PublicRsvpReadResponse,
  type RegenerateInvitationTokenRequest,
  type SubmitPublicGuestMessageRequest,
  type SubmitPublicGuestMessageResponse,
  type SubmitPublicRsvpRequest,
  type UpdateAdminInvitationRequest,
} from "./index.js";

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

  it("exposes the public RSVP operations and schemas", () => {
    expect(
      assertApiPath("/api/public/invitations/{publicCredential}/rsvp"),
    ).toBe("/api/public/invitations/{publicCredential}/rsvp");

    const request: SubmitPublicRsvpRequest = {
      attendees: [
        {
          inviteeId: "22222222-2222-4222-8222-222222222222",
          quantity: 1,
          type: "NAMED_INVITEE",
        },
      ],
      eventSelections: [
        {
          attending: true,
          eventId: "11111111-1111-4111-8111-111111111111",
          expectedAttendeeCount: 1,
        },
      ],
      expectedVersion: null,
      status: "ACCEPTED",
    };
    const response: PublicRsvpReadResponse = {
      checkinPass: {
        issuedAt: "2026-09-30T00:00:00.000Z",
        qrPayload: "B".repeat(43),
        status: "ACTIVE",
      },
      rsvp: {
        attendeeQuantityTotal: 1,
        attendees: request.attendees.map((attendee) => ({
          inviteeId: attendee.inviteeId ?? null,
          quantity: attendee.quantity,
          type: attendee.type,
        })),
        dietaryNotes: null,
        eventSelections: request.eventSelections,
        status: "ACCEPTED",
        version: 1,
      },
    };

    expect(response.rsvp?.eventSelections[0]?.eventId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(response.checkinPass?.qrPayload).toHaveLength(43);
  });

  it("exposes the public guest message operation and minimal response schema", () => {
    expect(
      assertApiPath("/api/public/invitations/{publicCredential}/messages"),
    ).toBe("/api/public/invitations/{publicCredential}/messages");

    const request: SubmitPublicGuestMessageRequest = {
      authorName: "Jo",
      message: "Congratulations!",
    };
    const anonymousRequest: SubmitPublicGuestMessageRequest = {
      message: "Best wishes",
    };
    const response: SubmitPublicGuestMessageResponse = {
      message: {
        createdAt: "2026-09-30T00:00:00.000Z",
      },
    };

    expect(request.authorName).toBe("Jo");
    expect(anonymousRequest.message).toBe("Best wishes");
    expect(Object.keys(response.message)).toEqual(["createdAt"]);
    expect(JSON.stringify(response)).not.toContain("invitationId");
    expect(JSON.stringify(response)).not.toContain("isHidden");
  });

  it("exposes the admin auth operations and safe response schemas", () => {
    expect(assertApiPath("/api/admin/auth/login")).toBe(
      "/api/admin/auth/login",
    );
    expect(assertApiPath("/api/admin/auth/me")).toBe("/api/admin/auth/me");
    expect(assertApiPath("/api/admin/auth/logout")).toBe(
      "/api/admin/auth/logout",
    );

    const request: AdminLoginRequest = {
      email: "owner@example.com",
      password: "correct horse battery staple",
    };
    const response: AdminAuthResponse = {
      csrfToken: "csrf-token",
      session: {
        expiresAt: "2026-09-30T12:00:00.000Z",
      },
      user: {
        email: request.email,
        id: "11111111-1111-4111-8111-111111111111",
        role: "OWNER",
      },
    };

    expect(response.user.email).toBe("owner@example.com");
    expect(JSON.stringify(response)).not.toContain("passwordHash");
    expect(JSON.stringify(response)).not.toContain("sessionToken");
    expect(JSON.stringify(response)).not.toContain("sessionTokenHash");
    expect(JSON.stringify(response)).not.toContain("csrfTokenHash");
  });

  it("exposes the admin read operations and safe response schemas", () => {
    expect(assertApiPath("/api/admin/dashboard")).toBe("/api/admin/dashboard");
    expect(assertApiPath("/api/admin/events")).toBe("/api/admin/events");
    expect(assertApiPath("/api/admin/invitations")).toBe(
      "/api/admin/invitations",
    );
    expect(assertApiPath("/api/admin/invitations/{invitationId}")).toBe(
      "/api/admin/invitations/{invitationId}",
    );
    expect(
      assertApiPath("/api/admin/invitations/{invitationId}/public-url"),
    ).toBe("/api/admin/invitations/{invitationId}/public-url");
    expect(
      assertApiPath("/api/admin/invitations/{invitationId}/archive"),
    ).toBe("/api/admin/invitations/{invitationId}/archive");
    expect(
      assertApiPath("/api/admin/invitations/{invitationId}/regenerate-token"),
    ).toBe("/api/admin/invitations/{invitationId}/regenerate-token");

    const dashboard: AdminDashboardResponse = {
      expectedByEvent: [],
      invitations: {
        active: 1,
        archived: 0,
        openedActive: 1,
      },
      rsvp: {
        accepted: 0,
        declined: 0,
        pending: 1,
      },
    };
    const list: AdminInvitationListResponse = {
      items: [
        {
          archivedAt: null,
          createdAt: "2026-09-30T00:00:00.000Z",
          displayName: "Example Household",
          greetingName: null,
          id: "11111111-1111-4111-8111-111111111111",
          inviteeCount: 2,
          lastOpenedAt: null,
          openCount: 0,
          rsvpDeadlineAt: null,
          rsvpStatus: "PENDING",
          status: "ACTIVE",
          updatedAt: "2026-09-30T00:00:00.000Z",
        },
      ],
      page: {
        number: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
      },
    };
    const detail: AdminInvitationDetailResponse = {
      invitation: {
        archivedAt: null,
        allowPlusOne: false,
        checkinPasses: [],
        createdAt: "2026-09-30T00:00:00.000Z",
        displayName: "Example Household",
        eligibility: [],
        firstOpenedAt: null,
        greetingName: null,
        id: "11111111-1111-4111-8111-111111111111",
        invitees: [],
        lastOpenedAt: null,
        maxAdditionalChildren: 0,
        messages: {
          hidden: 0,
          total: 0,
        },
        notes: "admin notes",
        openCount: 0,
        publicTokenVersion: 1,
        rsvp: null,
        rsvpDeadlineAt: null,
        status: "ACTIVE",
        updatedAt: "2026-09-30T00:00:00.000Z",
      },
    };
    const detailWithRsvp: AdminInvitationDetailResponse = {
      invitation: {
        ...detail.invitation,
        rsvp: {
          lastUpdatedAt: "2026-09-30T02:01:00.000Z",
          status: "ACCEPTED",
          submittedAt: "2026-09-30T02:00:00.000Z",
          version: 1,
        },
      },
    };
    const publicUrl: AdminInvitationPublicUrlResponse = {
      publicTokenVersion: 1,
      publicUrl: "https://invite.example.com/i/abc",
    };
    const createRequest: CreateAdminInvitationRequest = {
      allowPlusOne: true,
      displayName: "Created Household",
      eventIds: ["11111111-1111-4111-8111-111111111111"],
      greetingName: null,
      invitees: [
        {
          category: "ADULT",
          fullName: "Adult Guest",
          label: null,
        },
      ],
      maxAdditionalChildren: 0,
      notes: null,
      rsvpDeadlineAt: null,
    };
    const createResponse: CreateAdminInvitationResponse = {
      invitation: detail.invitation,
      publicTokenVersion: 1,
      publicUrl: "https://invite.example.com/i/abc",
    };
    const updateRequest: UpdateAdminInvitationRequest = {
      displayName: "Edited Household",
      expectedUpdatedAt: detail.invitation.updatedAt,
    };
    const archiveResponse: ArchiveAdminInvitationResponse = {
      invitation: {
        archivedAt: "2026-09-30T01:00:00.000Z",
        id: detail.invitation.id,
        status: "ARCHIVED",
      },
    };
    const regenerateRequest: RegenerateInvitationTokenRequest = {
      expectedTokenVersion: 1,
    };

    expect(dashboard.invitations.active).toBe(1);
    expect(list.items[0]?.rsvpStatus).toBe("PENDING");
    expect(detail.invitation.notes).toBe("admin notes");
    expect(Object.keys(detailWithRsvp.invitation.rsvp ?? {}).sort()).toEqual([
      "lastUpdatedAt",
      "status",
      "submittedAt",
      "version",
    ]);
    expect(publicUrl.publicUrl).toContain("/i/");
    expect(createRequest.invitees[0]?.category).toBe("ADULT");
    expect(createResponse.publicUrl).toContain("/i/");
    expect(updateRequest.expectedUpdatedAt).toBe(detail.invitation.updatedAt);
    expect(Object.keys(archiveResponse.invitation).sort()).toEqual([
      "archivedAt",
      "id",
      "status",
    ]);
    expect(JSON.stringify(archiveResponse)).not.toContain("reason");
    expect(regenerateRequest.expectedTokenVersion).toBe(1);
    expect(JSON.stringify(list)).not.toContain("notes");
    expect(JSON.stringify(list)).not.toContain("publicTokenVersion");
    expect(JSON.stringify(detail)).not.toContain("publicUrl");
    expect(JSON.stringify(detail)).not.toContain("publicTokenHash");
    expect(JSON.stringify(detail)).not.toContain("qrPayload");
    expect(JSON.stringify(detail)).not.toContain("tokenHash");
    expect(JSON.stringify(detailWithRsvp)).not.toContain("attendeeQuantityTotal");
    expect(JSON.stringify(detailWithRsvp)).not.toContain("eventSelections");
    expect(JSON.stringify(detailWithRsvp)).not.toContain("dietaryNotes");
    expect(JSON.stringify(detailWithRsvp)).not.toContain("guestNote");
    expect(JSON.stringify(createResponse)).not.toContain("publicTokenHash");
    expect(JSON.stringify(publicUrl)).not.toContain("publicTokenHash");
  });
});
