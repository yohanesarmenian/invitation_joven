import type {
  AdminEventsResponse,
  AdminInvitationDetailResponse,
  AdminInvitationPublicUrlResponse,
} from "@wedding-invitation/api-client/src/index";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const positiveCount = (v: unknown) => count(v) && v >= 1;
const date = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const nullableDate = (v: unknown) => v === null || date(v);
export const isUuid = (v: unknown) =>
  typeof v === "string" && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);

export function isEvents(v: unknown): v is AdminEventsResponse {
  return (
    object(v) &&
    Array.isArray(v.events) &&
    v.events.every(
      (event) =>
        object(event) &&
        isUuid(event.id) &&
        typeof event.slug === "string" &&
        typeof event.name === "string" &&
        typeof event.isActive === "boolean" &&
        count(event.displayOrder),
    )
  );
}

function isInvitee(v: unknown) {
  return (
    object(v) &&
    isUuid(v.id) &&
    typeof v.fullName === "string" &&
    (v.category === "ADULT" || v.category === "CHILD") &&
    (v.label === null || typeof v.label === "string") &&
    count(v.displayOrder)
  );
}
function isEvent(v: unknown) {
  return (
    object(v) &&
    isUuid(v.id) &&
    typeof v.slug === "string" &&
    typeof v.name === "string" &&
    typeof v.isActive === "boolean" &&
    count(v.displayOrder)
  );
}
function isEligibility(v: unknown) {
  return object(v) && isEvent(v.event);
}
function isRsvp(v: unknown) {
  return (
    v === null ||
    (object(v) &&
      (v.status === "PENDING" ||
        v.status === "ACCEPTED" ||
        v.status === "DECLINED") &&
      positiveCount(v.version) &&
      nullableDate(v.submittedAt) &&
      date(v.lastUpdatedAt))
  );
}
function isMessages(v: unknown) {
  return object(v) && count(v.total) && count(v.hidden) && v.hidden <= v.total;
}
function isPass(v: unknown) {
  return (
    object(v) &&
    (v.status === "ACTIVE" || v.status === "REVOKED" || v.status === "EXPIRED") &&
    positiveCount(v.credentialVersion) &&
    date(v.issuedAt) &&
    nullableDate(v.revokedAt) &&
    (v.revocationReason === null || typeof v.revocationReason === "string") &&
    nullableDate(v.expiresAt)
  );
}

export function isInvitationDetail(
  v: unknown,
): v is AdminInvitationDetailResponse {
  if (!object(v) || !object(v.invitation)) return false;
  const i = v.invitation;
  return (
    isUuid(i.id) &&
    typeof i.displayName === "string" &&
    (i.greetingName === null || typeof i.greetingName === "string") &&
    (i.status === "ACTIVE" || i.status === "ARCHIVED") &&
    typeof i.allowPlusOne === "boolean" &&
    count(i.maxAdditionalChildren) &&
    nullableDate(i.rsvpDeadlineAt) &&
    (i.notes === null || typeof i.notes === "string") &&
    positiveCount(i.publicTokenVersion) &&
    count(i.openCount) &&
    nullableDate(i.firstOpenedAt) &&
    nullableDate(i.lastOpenedAt) &&
    date(i.createdAt) &&
    date(i.updatedAt) &&
    nullableDate(i.archivedAt) &&
    Array.isArray(i.invitees) &&
    i.invitees.every(isInvitee) &&
    Array.isArray(i.eligibility) &&
    i.eligibility.every(isEligibility) &&
    isRsvp(i.rsvp) &&
    isMessages(i.messages) &&
    Array.isArray(i.checkinPasses) &&
    i.checkinPasses.every(isPass)
  );
}

export function isPublicUrl(
  v: unknown,
): v is AdminInvitationPublicUrlResponse {
  return (
    object(v) &&
    typeof v.publicUrl === "string" &&
    v.publicUrl.length > 0 &&
    positiveCount(v.publicTokenVersion)
  );
}
