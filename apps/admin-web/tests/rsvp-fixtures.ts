import type {
  AdminEventsResponse,
  AdminRsvpDetailResponse,
  AdminRsvpListResponse,
} from "@wedding-invitation/api-client/src/index";

export const rsvpEvents: AdminEventsResponse["events"] = [
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
];

export const rsvpItem: AdminRsvpListResponse["items"][number] = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  invitation: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "Sample household",
    status: "ACTIVE",
  },
  status: "ACCEPTED",
  version: 3,
  attendeeCount: 4,
  attendingEventCount: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T17:30:00.000Z",
  submittedByAdmin: false,
};

export const rsvpList: AdminRsvpListResponse = {
  items: [
    rsvpItem,
    {
      ...rsvpItem,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      invitation: {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        displayName: "Owner override household",
        status: "ARCHIVED",
      },
      status: "DECLINED",
      version: 2,
      attendeeCount: 0,
      attendingEventCount: 0,
      submittedByAdmin: true,
    },
  ],
  page: { number: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
};

export const rsvpDetail: AdminRsvpDetailResponse = {
  history: [],
  rsvp: {
    id: rsvpItem.id,
    invitation: rsvpItem.invitation,
    status: "ACCEPTED",
    version: 3,
    eventSelections: [
      {
        event: rsvpEvents[0]!,
        attending: true,
        expectedAttendeeCount: 4,
      },
      {
        event: rsvpEvents[1]!,
        attending: false,
        expectedAttendeeCount: 0,
      },
    ],
    attendees: [
      {
        type: "NAMED_INVITEE",
        inviteeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        displayName: "Snapshot Guest",
        quantity: 1,
      },
      {
        type: "PLUS_ONE",
        inviteeId: null,
        displayName: "Snapshot Companion",
        quantity: 1,
      },
      {
        type: "ADDITIONAL_CHILD",
        inviteeId: null,
        displayName: null,
        quantity: 2,
      },
    ],
    dietaryNotes: "Vegetarian",
    guestNote: "Please seat us near family",
    submittedAt: "2026-10-01T17:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T17:30:00.000Z",
    submittedByAdmin: true,
    adminUser: {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      email: "owner@example.com",
    },
    overrideReason: "Guest replied by phone",
    checkinPasses: [
      {
        status: "ACTIVE",
        credentialVersion: 1,
        issuedAt: "2026-10-01T17:20:00.000Z",
        revokedAt: null,
        revocationReason: null,
        expiresAt: null,
      },
      {
        status: "REVOKED",
        credentialVersion: 1,
        issuedAt: "2026-09-30T17:20:00.000Z",
        revokedAt: "2026-10-01T10:00:00.000Z",
        revocationReason: "RSVP_DECLINED",
        expiresAt: null,
      },
    ],
  },
};
