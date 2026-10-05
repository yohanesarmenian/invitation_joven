import type {
  AdminEventsResponse,
  AdminRsvpDetailResponse,
  AdminRsvpListResponse,
} from "@wedding-invitation/api-client/src/index";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const positiveCount = (value: unknown): value is number =>
  count(value) && value >= 1;
const date = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const nullableDate = (value: unknown) => value === null || date(value);
export const isUuid = (value: unknown) =>
  typeof value === "string" &&
  /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const isRsvpStatus = (value: unknown) =>
  value === "PENDING" || value === "ACCEPTED" || value === "DECLINED";
const isInvitationStatus = (value: unknown) =>
  value === "ACTIVE" || value === "ARCHIVED";

const forbiddenKeys = new Set([
  "publicTokenHash",
  "publicUrl",
  "qrPayload",
  "sessionToken",
  "sessionTokenHash",
  "tokenHash",
]);

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!object(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => forbiddenKeys.has(key) || hasForbiddenKey(nested),
  );
}

function isEvent(value: unknown) {
  return (
    object(value) &&
    isUuid(value.id) &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.isActive === "boolean" &&
    count(value.displayOrder)
  );
}

function isInvitationSummary(value: unknown) {
  return (
    object(value) &&
    isUuid(value.id) &&
    typeof value.displayName === "string" &&
    isInvitationStatus(value.status)
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isPage(value: unknown) {
  if (!object(value)) return false;
  const pageSize = value.pageSize;
  const totalItems = value.totalItems;
  return (
    positiveCount(value.number) &&
    positiveCount(pageSize) &&
    pageSize <= 100 &&
    count(totalItems) &&
    count(value.totalPages) &&
    value.totalPages === Math.ceil(totalItems / pageSize)
  );
}

function isPass(value: unknown) {
  return (
    object(value) &&
    (value.status === "ACTIVE" ||
      value.status === "REVOKED" ||
      value.status === "EXPIRED") &&
    positiveCount(value.credentialVersion) &&
    date(value.issuedAt) &&
    nullableDate(value.revokedAt) &&
    (value.revocationReason === null ||
      typeof value.revocationReason === "string") &&
    nullableDate(value.expiresAt)
  );
}

function isEventSelection(value: unknown) {
  return (
    object(value) &&
    isEvent(value.event) &&
    typeof value.attending === "boolean" &&
    count(value.expectedAttendeeCount)
  );
}

function isAttendee(value: unknown) {
  return (
    object(value) &&
    (value.type === "NAMED_INVITEE" ||
      value.type === "PLUS_ONE" ||
      value.type === "ADDITIONAL_CHILD") &&
    (value.inviteeId === null || isUuid(value.inviteeId)) &&
    (value.displayName === null || typeof value.displayName === "string") &&
    positiveCount(value.quantity)
  );
}

export function isAdminEvents(value: unknown): value is AdminEventsResponse {
  return (
    object(value) &&
    !hasForbiddenKey(value) &&
    Array.isArray(value.events) &&
    value.events.every(isEvent)
  );
}

export function isRsvpList(value: unknown): value is AdminRsvpListResponse {
  if (!object(value) || !object(value.page)) return false;
  const page = value.page;
  return (
    !hasForbiddenKey(value) &&
    Array.isArray(value.items) &&
    isPage(page) &&
    value.items.length <= (page as { pageSize: number }).pageSize &&
    value.items.every(
      (item) =>
        object(item) &&
        hasOnlyKeys(item, [
          "id",
          "invitation",
          "status",
          "version",
          "attendeeCount",
          "attendingEventCount",
          "createdAt",
          "updatedAt",
          "submittedByAdmin",
        ]) &&
        isUuid(item.id) &&
        isInvitationSummary(item.invitation) &&
        isRsvpStatus(item.status) &&
        positiveCount(item.version) &&
        count(item.attendeeCount) &&
        count(item.attendingEventCount) &&
        date(item.createdAt) &&
        date(item.updatedAt) &&
        typeof item.submittedByAdmin === "boolean",
    )
  );
}

export function isRsvpDetail(
  value: unknown,
): value is AdminRsvpDetailResponse {
  if (!object(value) || !object(value.rsvp) || hasForbiddenKey(value))
    return false;
  const rsvp = value.rsvp;
  return (
    isUuid(rsvp.id) &&
    isInvitationSummary(rsvp.invitation) &&
    isRsvpStatus(rsvp.status) &&
    positiveCount(rsvp.version) &&
    Array.isArray(rsvp.eventSelections) &&
    rsvp.eventSelections.every(isEventSelection) &&
    Array.isArray(rsvp.attendees) &&
    rsvp.attendees.every(isAttendee) &&
    (rsvp.dietaryNotes === null || typeof rsvp.dietaryNotes === "string") &&
    (rsvp.guestNote === null || typeof rsvp.guestNote === "string") &&
    nullableDate(rsvp.submittedAt) &&
    date(rsvp.createdAt) &&
    date(rsvp.updatedAt) &&
    typeof rsvp.submittedByAdmin === "boolean" &&
    (rsvp.adminUser === undefined ||
      (object(rsvp.adminUser) &&
        isUuid(rsvp.adminUser.id) &&
        typeof rsvp.adminUser.email === "string")) &&
    (rsvp.overrideReason === undefined ||
      typeof rsvp.overrideReason === "string") &&
    Array.isArray(rsvp.checkinPasses) &&
    rsvp.checkinPasses.every(isPass)
  );
}
