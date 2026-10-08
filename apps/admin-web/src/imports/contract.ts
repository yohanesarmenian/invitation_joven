import type {
  GuestImportValidateResponse,
  GuestImportCommitResponse,
} from "@wedding-invitation/api-client/src/index";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const uuid = (v: unknown) =>
  text(v) && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const instant = (v: unknown) =>
  text(v) &&
  /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
const codes = new Set([
  "REQUIRED_FIELD",
  "INVALID_VALUE",
  "INVALID_JSON",
  "INVALID_DATE",
  "UNKNOWN_EVENT",
  "INACTIVE_EVENT",
  "INVALID_INVITEE",
  "POSSIBLE_DUPLICATE",
]);
function parsed(v: unknown) {
  return (
    object(v) &&
    text(v.displayName) &&
    nullableText(v.greetingName) &&
    typeof v.allowPlusOne === "boolean" &&
    count(v.maxAdditionalChildren) &&
    (v.rsvpDeadlineLocal === null ||
      (text(v.rsvpDeadlineLocal) &&
        /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(v.rsvpDeadlineLocal))) &&
    (v.rsvpDeadlineAt === null || instant(v.rsvpDeadlineAt)) &&
    (v.rsvpDeadlineLocal === null) === (v.rsvpDeadlineAt === null) &&
    Array.isArray(v.invitees) &&
    v.invitees.every(
      (i) =>
        object(i) &&
        text(i.fullName) &&
        (i.category === "ADULT" || i.category === "CHILD") &&
        nullableText(i.label),
    ) &&
    Array.isArray(v.eligibleEventSlugs) &&
    v.eligibleEventSlugs.every(text)
  );
}
export function isPreview(v: unknown): v is GuestImportValidateResponse {
  if (
    !object(v) ||
    !uuid(v.previewId) ||
    !instant(v.expiresAt) ||
    !object(v.summary) ||
    !Array.isArray(v.rows) ||
    v.rows.length > 500
  )
    return false;
  const s = v.summary;
  if (![s.totalRows, s.validRows, s.warningRows, s.errorRows].every(count))
    return false;
  const numbers = new Set<number>();
  if (
    !v.rows.every((r) => {
      if (
        !object(r) ||
        !count(r.rowNumber) ||
        r.rowNumber < 2 ||
        numbers.has(r.rowNumber)
      )
        return false;
      numbers.add(r.rowNumber);
      const issues = (items: unknown) =>
        Array.isArray(items) &&
        items.every(
          (i) =>
            object(i) &&
            i.rowNumber === r.rowNumber &&
            nullableText(i.column) &&
            nullableText(i.field) &&
            text(i.code) &&
            codes.has(i.code) &&
            text(i.message),
        );
      if (!issues(r.errors) || !issues(r.warnings)) return false;
      if (r.status === "ERROR")
        return r.parsed === undefined || parsed(r.parsed);
      return (
        (r.status === "VALID" || r.status === "VALID_WITH_WARNINGS") &&
        parsed(r.parsed)
      );
    })
  )
    return false;
  return (
    s.totalRows === v.rows.length &&
    s.validRows === v.rows.filter((r) => r.status !== "ERROR").length &&
    s.errorRows === v.rows.filter((r) => r.status === "ERROR").length &&
    s.warningRows ===
      v.rows.filter((r) => r.status === "VALID_WITH_WARNINGS").length
  );
}
export function isReceipt(v: unknown): v is GuestImportCommitResponse {
  if (!object(v) || !object(v.importBatch)) return false;
  const b = v.importBatch;
  return (
    uuid(b.id) &&
    b.status === "COMMITTED" &&
    count(b.createdInvitationCount) &&
    b.createdInvitationCount > 0 &&
    count(b.createdInviteeCount) &&
    count(b.warningCount)
  );
}
