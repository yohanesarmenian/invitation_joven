import type {
  AdminEventsResponse,
  AdminInvitationDetailResponse,
  AdminInvitationListResponse,
  CreateAdminInvitationRequest,
} from "@wedding-invitation/api-client/src/index";
export const events: AdminEventsResponse["events"] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "reception",
    name: "Reception",
    isActive: true,
    displayOrder: 1,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    slug: "ceremony",
    name: "Ceremony",
    isActive: true,
    displayOrder: 2,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    slug: "inactive",
    name: "Old event",
    isActive: false,
    displayOrder: 3,
  },
];
export const item: AdminInvitationListResponse["items"][number] = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  displayName: "Sample household",
  greetingName: "Dear sample guests",
  status: "ACTIVE",
  rsvpStatus: "ACCEPTED",
  inviteeCount: 3,
  openCount: 7,
  lastOpenedAt: "2026-10-01T17:30:00.000Z",
  rsvpDeadlineAt: "2026-12-25T16:59:59.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  archivedAt: null,
};
export const list: AdminInvitationListResponse = {
  items: [item],
  page: { number: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
};
export const body: CreateAdminInvitationRequest = {
  displayName: "Sample household",
  greetingName: null,
  allowPlusOne: false,
  maxAdditionalChildren: 0,
  rsvpDeadlineAt: null,
  notes: null,
  eventIds: [events[0]!.id],
  invitees: [{ fullName: "Sample guest", category: "ADULT", label: null }],
};
export const detail: AdminInvitationDetailResponse = {
  invitation: {
    id: item.id,
    displayName: item.displayName,
    greetingName: item.greetingName,
    status: "ACTIVE",
    allowPlusOne: false,
    maxAdditionalChildren: 0,
    rsvpDeadlineAt: item.rsvpDeadlineAt,
    notes: "Internal note",
    publicTokenVersion: 1,
    openCount: item.openCount,
    firstOpenedAt: "2026-10-01T16:30:00.000Z",
    lastOpenedAt: item.lastOpenedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    archivedAt: null,
    invitees: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        fullName: "Sample guest",
        category: "ADULT",
        label: null,
        displayOrder: 1,
        updatedAt: "2026-10-01T00:00:01.000Z",
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        fullName: "Sample child",
        category: "CHILD",
        label: "Child",
        displayOrder: 2,
        updatedAt: "2026-10-01T00:00:02.000Z",
      },
    ],
    eligibility: [{ event: events[0]! }, { event: events[1]! }],
    rsvp: {
      status: "ACCEPTED",
      version: 2,
      submittedAt: "2026-10-01T17:00:00.000Z",
      lastUpdatedAt: "2026-10-01T17:10:00.000Z",
    },
    messages: { total: 2, hidden: 1 },
    checkinPasses: [
      {
        status: "ACTIVE",
        credentialVersion: 1,
        issuedAt: "2026-10-01T17:20:00.000Z",
        revokedAt: null,
        revocationReason: null,
        expiresAt: null,
      },
    ],
  },
};
