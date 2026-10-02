import type {
  AdminEventsResponse,
  CreateAdminInvitationRequest,
} from "@wedding-invitation/api-client/src/index";
export type CreateFields = Omit<
  CreateAdminInvitationRequest,
  "rsvpDeadlineAt" | "maxAdditionalChildren"
> & { deadline: string; children: string };
export type FormErrors = Record<string, string>;
// Explicit Jakarta wall time, independent of the browser/server timezone.
export function deadlineToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(value))
    return null;
  const date = new Date(`${value}+07:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const roundTrip = new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString();
  const normalized =
    value.length === 16
      ? `${value}:00.000`
      : value.includes(".")
        ? value.padEnd(23, "0")
        : `${value}.000`;
  return roundTrip.slice(0, -1) === normalized ? date.toISOString() : null;
}
export function prepareInvitation(
  fields: CreateFields,
  events: AdminEventsResponse["events"],
): { body: CreateAdminInvitationRequest; errors: FormErrors } {
  const errors: FormErrors = {};
  const nullable = (v: string | null | undefined) => v?.trim() || null;
  if (!fields.displayName.trim()) errors.displayName = "Enter a display name.";
  const maxAdditionalChildren = Number(fields.children);
  if (
    !/^\d+$/.test(fields.children) ||
    !Number.isSafeInteger(maxAdditionalChildren)
  )
    errors.children = "Enter a whole number of zero or more.";
  const rsvpDeadlineAt = fields.deadline
    ? deadlineToIso(fields.deadline)
    : null;
  if (fields.deadline && !rsvpDeadlineAt)
    errors.deadline = "Enter a valid date and time in Asia/Jakarta.";
  if (
    !fields.eventIds.length ||
    new Set(fields.eventIds).size !== fields.eventIds.length ||
    fields.eventIds.some(
      (id) => !events.some((event) => event.id === id && event.isActive),
    )
  )
    errors.eventIds = "Select at least one active event.";
  if (!fields.invitees.length) errors.invitees = "Add at least one invitee.";
  fields.invitees.forEach((invitee, index) => {
    if (!invitee.fullName.trim())
      errors[`invitee-${index}`] = "Enter the invitee’s full name.";
    if (invitee.category !== "ADULT" && invitee.category !== "CHILD")
      errors[`category-${index}`] = "Select Adult or Child.";
  });
  return {
    errors,
    body: {
      displayName: fields.displayName.trim(),
      greetingName: nullable(fields.greetingName),
      allowPlusOne: fields.allowPlusOne,
      maxAdditionalChildren,
      rsvpDeadlineAt,
      notes: nullable(fields.notes),
      eventIds: fields.eventIds,
      invitees: fields.invitees.map((row) => ({
        fullName: row.fullName.trim(),
        category: row.category,
        label: nullable(row.label),
      })),
    },
  };
}
