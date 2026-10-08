import { describe, expect, it } from "vitest";
import type { components, paths } from "./generated/schema.js";
import {
  createInvitationApiClient,
  type AdminInviteeMutationResponse,
  type AdminAuthResponse,
  type AdminDashboardResponse,
  type AdminGuestMessageListResponse,
  type GuestImportValidateResponse,
  type ArchiveAdminInvitationResponse,
  type CreateAdminInviteeRequest,
  type CreateAdminInvitationRequest,
  type CreateAdminInvitationResponse,
  type AdminInvitationDetailResponse,
  type AdminInvitationListResponse,
  type AdminInvitationPublicUrlResponse,
  type AdminRsvpDetailResponse,
  type AdminRsvpListResponse,
  type AdminLoginRequest,
  type OverrideAdminRsvpRequest,
  type PublicRsvpReadResponse,
  type RegenerateInvitationTokenRequest,
  type ReplaceAdminInvitationEventsRequest,
  type ReplaceAdminInvitationEventsResponse,
  type SubmitPublicGuestMessageRequest,
  type SubmitPublicGuestMessageResponse,
  type SubmitPublicRsvpRequest,
  type UpdateAdminGuestMessageRequest,
  type UpdateAdminGuestMessageResponse,
  type UpdateAdminInviteeRequest,
  type UpdateAdminInvitationRequest,
  type ValidateGuestImportRequest,
  type ValidateGuestImportResponse,
} from "./index.js";

function assertApiPath(path: keyof paths): keyof paths {
  return path;
}

function assertApiMethod<TPath extends keyof paths>(
  _path: TPath,
  method: keyof paths[TPath],
): keyof paths[TPath] {
  return method;
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
    expect(assertApiPath("/api/admin/invitations/{invitationId}/archive")).toBe(
      "/api/admin/invitations/{invitationId}/archive",
    );
    expect(
      assertApiPath("/api/admin/invitations/{invitationId}/regenerate-token"),
    ).toBe("/api/admin/invitations/{invitationId}/regenerate-token");
    expect(
      assertApiPath("/api/admin/invitations/{invitationId}/invitees"),
    ).toBe("/api/admin/invitations/{invitationId}/invitees");
    expect(assertApiPath("/api/admin/invitees/{inviteeId}")).toBe(
      "/api/admin/invitees/{inviteeId}",
    );
    expect(assertApiPath("/api/admin/invitations/{invitationId}/events")).toBe(
      "/api/admin/invitations/{invitationId}/events",
    );
    expect(assertApiPath("/api/admin/invitations/{invitationId}/rsvp")).toBe(
      "/api/admin/invitations/{invitationId}/rsvp",
    );
    expect(assertApiPath("/api/admin/messages")).toBe("/api/admin/messages");
    expect(
      assertApiPath("/api/admin/invitations/{invitationId}/messages"),
    ).toBe("/api/admin/invitations/{invitationId}/messages");
    expect(assertApiPath("/api/admin/messages/{messageId}")).toBe(
      "/api/admin/messages/{messageId}",
    );
    expect(assertApiPath("/api/admin/rsvps")).toBe("/api/admin/rsvps");
    expect(assertApiPath("/api/admin/rsvps/{rsvpId}")).toBe(
      "/api/admin/rsvps/{rsvpId}",
    );
    expect(assertApiMethod("/api/admin/invitations", "post")).toBe("post");
    expect(
      assertApiMethod("/api/admin/invitations/{invitationId}/invitees", "post"),
    ).toBe("post");
    expect(assertApiMethod("/api/admin/invitees/{inviteeId}", "delete")).toBe(
      "delete",
    );
    expect(assertApiMethod("/api/admin/rsvps", "get")).toBe("get");
    expect(assertApiMethod("/api/admin/rsvps/{rsvpId}", "get")).toBe("get");
    expect(
      assertApiMethod("/api/admin/invitations/{invitationId}/rsvp", "put"),
    ).toBe("put");
    expect(assertApiMethod("/api/admin/messages", "get")).toBe("get");
    expect(
      assertApiMethod("/api/admin/invitations/{invitationId}/messages", "get"),
    ).toBe("get");
    expect(assertApiMethod("/api/admin/messages/{messageId}", "patch")).toBe(
      "patch",
    );

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
        invitees: [
          {
            category: "ADULT",
            displayOrder: 0,
            fullName: "Adult Guest",
            id: "22222222-2222-4222-8222-222222222222",
            label: null,
            updatedAt: "2026-09-30T00:00:00.000Z",
          },
        ],
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
    const createInviteeRequest: CreateAdminInviteeRequest = {
      category: "ADULT",
      fullName: "New Guest",
      label: null,
    };
    const inviteeResponse: AdminInviteeMutationResponse = {
      category: "ADULT",
      createdAt: "2026-09-30T00:00:00.000Z",
      displayOrder: 0,
      fullName: "New Guest",
      id: "22222222-2222-4222-8222-222222222222",
      invitationId: detail.invitation.id,
      label: null,
      updatedAt: "2026-09-30T00:00:00.000Z",
    };
    const updateInviteeRequest: UpdateAdminInviteeRequest = {
      expectedUpdatedAt: detail.invitation.invitees[0]!.updatedAt,
      label: "VIP",
    };
    const replaceEventsRequest: ReplaceAdminInvitationEventsRequest = {
      eventIds: ["33333333-3333-4333-8333-333333333333"],
    };
    const replaceEventsResponse: ReplaceAdminInvitationEventsResponse = {
      eligibility: [
        {
          event: {
            displayOrder: 1,
            id: replaceEventsRequest.eventIds[0]!,
            isActive: true,
            name: "Ceremony",
            slug: "ceremony",
          },
        },
      ],
    };
    const overrideRsvpRequest: OverrideAdminRsvpRequest = {
      attendees: [
        {
          inviteeId: "22222222-2222-4222-8222-222222222222",
          quantity: 1,
          type: "NAMED_INVITEE",
        },
      ],
      dietaryNotes: null,
      eventSelections: [
        {
          attending: true,
          eventId: "33333333-3333-4333-8333-333333333333",
          expectedAttendeeCount: 1,
        },
      ],
      expectedVersion: null,
      overrideReason: "Guest replied by phone",
      status: "ACCEPTED",
    };
    const adminRsvpList: AdminRsvpListResponse = {
      items: [
        {
          attendeeCount: 1,
          attendingEventCount: 1,
          createdAt: "2026-09-30T00:00:00.000Z",
          id: "44444444-4444-4444-8444-444444444444",
          invitation: {
            displayName: "Example Household",
            id: detail.invitation.id,
            status: "ACTIVE",
          },
          status: "ACCEPTED",
          submittedByAdmin: true,
          updatedAt: "2026-09-30T00:00:00.000Z",
          version: 1,
        },
      ],
      page: {
        number: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
      },
    };
    const adminRsvpDetail: AdminRsvpDetailResponse = {
      rsvp: {
        adminUser: {
          email: "owner@example.com",
          id: "55555555-5555-4555-8555-555555555555",
        },
        attendees: [
          {
            displayName: null,
            inviteeId: "22222222-2222-4222-8222-222222222222",
            quantity: 1,
            type: "NAMED_INVITEE",
          },
        ],
        checkinPasses: [
          {
            credentialVersion: 1,
            expiresAt: null,
            issuedAt: "2026-09-30T00:00:00.000Z",
            revocationReason: null,
            revokedAt: null,
            status: "ACTIVE",
          },
        ],
        createdAt: "2026-09-30T00:00:00.000Z",
        dietaryNotes: null,
        eventSelections: [
          {
            attending: true,
            event: {
              displayOrder: 1,
              id: "33333333-3333-4333-8333-333333333333",
              isActive: true,
              name: "Ceremony",
              slug: "ceremony",
            },
            expectedAttendeeCount: 1,
          },
        ],
        guestNote: "Read-only note",
        id: adminRsvpList.items[0]!.id,
        invitation: adminRsvpList.items[0]!.invitation,
        overrideReason: overrideRsvpRequest.overrideReason,
        status: "ACCEPTED",
        submittedAt: "2026-09-30T00:00:00.000Z",
        submittedByAdmin: true,
        updatedAt: "2026-09-30T00:00:00.000Z",
        version: 1,
      },
    };
    const guestMessages: AdminGuestMessageListResponse = {
      items: [
        {
          authorName: "Guest Author",
          createdAt: "2026-09-30T00:00:00.000Z",
          id: "66666666-6666-4666-8666-666666666666",
          invitation: {
            displayName: "Example Household",
            id: detail.invitation.id,
          },
          isHidden: false,
          message: "Congratulations!",
        },
      ],
      page: {
        number: 1,
        pageSize: 25,
        totalItems: 1,
        totalPages: 1,
      },
    };
    const updateGuestMessageRequest: UpdateAdminGuestMessageRequest = {
      isHidden: true,
    };
    const updateGuestMessageResponse: UpdateAdminGuestMessageResponse = {
      ...guestMessages.items[0]!,
      isHidden: true,
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
    expect(createInviteeRequest.category).toBe("ADULT");
    expect(updateInviteeRequest.expectedUpdatedAt).toBe(
      detail.invitation.invitees[0]?.updatedAt,
    );
    expect(inviteeResponse.invitationId).toBe(detail.invitation.id);
    expect(replaceEventsResponse.eligibility[0]?.event.id).toBe(
      replaceEventsRequest.eventIds[0],
    );
    expect(overrideRsvpRequest.expectedVersion).toBeNull();
    expect(overrideRsvpRequest.overrideReason).toBe("Guest replied by phone");
    expect(adminRsvpList.items[0]?.attendeeCount).toBe(1);
    expect(adminRsvpDetail.rsvp.adminUser?.email).toBe("owner@example.com");
    expect(guestMessages.items[0]?.isHidden).toBe(false);
    expect(updateGuestMessageRequest.isHidden).toBe(true);
    expect(updateGuestMessageResponse.isHidden).toBe(true);
    expect(JSON.stringify(list)).not.toContain("notes");
    expect(JSON.stringify(list)).not.toContain("publicTokenVersion");
    expect(JSON.stringify(detail)).not.toContain("publicUrl");
    expect(JSON.stringify(detail)).not.toContain("publicTokenHash");
    expect(JSON.stringify(detail)).not.toContain("qrPayload");
    expect(JSON.stringify(detail)).not.toContain("tokenHash");
    expect(JSON.stringify(detailWithRsvp)).not.toContain(
      "attendeeQuantityTotal",
    );
    expect(JSON.stringify(detailWithRsvp)).not.toContain("eventSelections");
    expect(JSON.stringify(detailWithRsvp)).not.toContain("dietaryNotes");
    expect(JSON.stringify(detailWithRsvp)).not.toContain("guestNote");
    expect(JSON.stringify(createResponse)).not.toContain("publicTokenHash");
    expect(JSON.stringify(publicUrl)).not.toContain("publicTokenHash");
    expect(JSON.stringify(inviteeResponse)).not.toContain("dietaryNotes");
    expect(JSON.stringify(inviteeResponse)).not.toContain("guestNote");
    expect(JSON.stringify(replaceEventsResponse)).not.toContain(
      "publicTokenHash",
    );
    expect(JSON.stringify(replaceEventsResponse)).not.toContain("qrPayload");
    expect(JSON.stringify(adminRsvpList)).not.toContain("dietaryNotes");
    expect(JSON.stringify(adminRsvpList)).not.toContain("guestNote");
    expect(JSON.stringify(adminRsvpDetail)).not.toContain("qrPayload");
    expect(JSON.stringify(adminRsvpDetail)).not.toContain("tokenHash");
    expect(JSON.stringify(adminRsvpDetail)).not.toContain("publicTokenHash");
    expect(JSON.stringify(guestMessages)).not.toContain("publicTokenHash");
    expect(JSON.stringify(guestMessages)).not.toContain("qrPayload");
    expect(JSON.stringify(guestMessages)).not.toContain("tokenHash");
    expect(JSON.stringify(guestMessages)).not.toContain("dietaryNotes");
    expect(JSON.stringify(guestMessages)).not.toContain("guestNote");
    expect(JSON.stringify(updateGuestMessageResponse)).not.toContain(
      "hiddenAt",
    );
    expect(JSON.stringify(updateGuestMessageResponse)).not.toContain(
      "moderationReason",
    );
  });

  it("exposes the admin import validate multipart operation and preview schema", () => {
    expect(assertApiPath("/api/admin/imports/guest/validate")).toBe(
      "/api/admin/imports/guest/validate",
    );
    expect(
      assertApiMethod("/api/admin/imports/guest/validate", "post"),
    ).toBe("post");

    const request: ValidateGuestImportRequest = {
      file: "binary-file",
    };
    const response: ValidateGuestImportResponse = {
      expiresAt: "2027-01-16T11:30:00.000Z",
      previewId: "11111111-1111-4111-8111-111111111111",
      rows: [
        {
          errors: [],
          parsed: {
            allowPlusOne: true,
            displayName: "Example Household",
            eligibleEventSlugs: ["ceremony"],
            greetingName: null,
            invitees: [
              {
                category: "ADULT",
                fullName: "Adult Guest",
                label: null,
              },
            ],
            maxAdditionalChildren: 0,
            rsvpDeadlineAt: "2027-01-16T11:30:00.000Z",
            rsvpDeadlineLocal: "2027-01-16 18:30",
          },
          rowNumber: 2,
          status: "VALID_WITH_WARNINGS",
          warnings: [
            {
              code: "POSSIBLE_DUPLICATE",
              column: "displayName",
              field: "displayName",
              message: "Possible duplicate household by normalized display name.",
              rowNumber: 2,
            },
          ],
        },
      ],
      summary: {
        errorRows: 0,
        totalRows: 1,
        validRows: 1,
        warningRows: 1,
      },
    };
    const aliasResponse: GuestImportValidateResponse = response;

    expect(request.file).toBe("binary-file");
    expect(aliasResponse.rows[0]?.warnings[0]?.code).toBe(
      "POSSIBLE_DUPLICATE",
    );
    expect(aliasResponse.rows[0]?.parsed?.greetingName).toBeNull();
    expect(aliasResponse.rows[0]?.parsed?.allowPlusOne).toBe(true);
    expect(aliasResponse.rows[0]?.parsed?.maxAdditionalChildren).toBe(0);
    expect(aliasResponse.rows[0]?.parsed?.rsvpDeadlineLocal).toBe(
      "2027-01-16 18:30",
    );
    expect(aliasResponse.rows[0]?.parsed?.rsvpDeadlineAt).toBe(
      "2027-01-16T11:30:00.000Z",
    );
    expect(aliasResponse.rows[0]?.parsed?.invitees[0]?.fullName).toBe(
      "Adult Guest",
    );
    expect(aliasResponse.rows[0]?.parsed?.eligibleEventSlugs).toEqual([
      "ceremony",
    ]);
  });
});
