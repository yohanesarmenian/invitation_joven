import type { ApiComponents } from "@wedding-invitation/api-client/src/index";

type Schemas = ApiComponents["schemas"];
export type Events = Schemas["AdminCheckinEventsResponseDto"];
export type Preview = Schemas["AdminCheckinValidateResponseDto"];
export type Search = Schemas["AdminCheckinSearchResponseDto"];
export type Candidate = Search["items"][number];
export type Receipt = Schemas["AdminCheckinConfirmResponseDto"];
export type ManualStatus = Schemas["AdminCheckinManualStatusResponseDto"];
export const qrPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const obj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown) => typeof v === "string" && uuidPattern.test(v);
const count = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const time = (v: unknown) =>
  typeof v === "string" && Number.isFinite(Date.parse(v));
const summary = (v: unknown) =>
  obj(v) && uuid(v.id) && typeof v.name === "string";
const operator = (v: unknown) =>
  obj(v) &&
  uuid(v.id) &&
  typeof v.email === "string" &&
  (v.role === "OWNER" ||
    v.role === "CHECKIN_STAFF" ||
    v.role === "GUEST_MANAGER");
const previous = (v: unknown) =>
  obj(v) &&
  typeof v.attendeeCount === "number" &&
  Number.isSafeInteger(v.attendeeCount) &&
  v.attendeeCount >= 0 &&
  time(v.checkedInAt) &&
  (v.method === "QR" || v.method === "MANUAL") &&
  (v.confirmedBy == null || operator(v.confirmedBy));
export const isEvents = (v: unknown): v is Events =>
  obj(v) &&
  Array.isArray(v.events) &&
  v.events.every(
    (e) =>
      summary(e) &&
      obj(e) &&
      typeof e.slug === "string" &&
      (e.startsAt === null || time(e.startsAt)),
  );
export const isCandidate = (v: unknown): v is Candidate =>
  obj(v) &&
  obj(v.invitation) &&
  uuid(v.invitation.id) &&
  typeof v.invitation.displayName === "string" &&
  summary(v.event) &&
  count(v.expectedAttendeeCount) &&
  typeof v.alreadyCheckedIn === "boolean";
export const isSearch = (v: unknown): v is Search =>
  obj(v) &&
  Array.isArray(v.items) &&
  v.items.length <= 10 &&
  v.items.every(isCandidate);
export const isPreview = (v: unknown): v is Preview =>
  obj(v) &&
  ((v.status === "VALID" &&
    v.alreadyCheckedIn === false &&
    v.previousCheckin === null) ||
    (v.status === "ALREADY_CONFIRMED" &&
      v.alreadyCheckedIn === true &&
      previous(v.previousCheckin))) &&
  isCandidate(v);
export const isReceipt = (v: unknown): v is Receipt =>
  obj(v) &&
  obj(v.checkinRecord) &&
  uuid(v.checkinRecord.id) &&
  previous(v.checkinRecord) &&
  operator(v.checkinRecord.confirmedBy);
export const isManualStatus = (v: unknown): v is ManualStatus =>
  obj(v) &&
  ((v.status === "NOT_CONFIRMED" &&
    v.alreadyCheckedIn === false &&
    v.previousCheckin === null) ||
    (v.status === "ALREADY_CONFIRMED" &&
      v.alreadyCheckedIn === true &&
      previous(v.previousCheckin)));
