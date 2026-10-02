import type {
  AdminEventsResponse,
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
