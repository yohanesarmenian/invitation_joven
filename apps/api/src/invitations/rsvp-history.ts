import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "../generated/prisma/client.js";

export type RsvpHistoryValues = {
  status: string;
  attendees: {
    type: string;
    inviteeId: string | null;
    name: string;
    quantity: number;
  }[];
  eventSelections: {
    eventId: string;
    name: string;
    attending: boolean;
    expectedAttendeeCount: number;
  }[];
  dietaryNotes: string | null;
  submittedByAdminUserId: string | null;
  overrideReason: string | null;
};
export type RsvpHistoryChange = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export async function readRsvpHistoryValues(
  tx: Prisma.TransactionClient,
  invitationId: string,
) {
  const row = await tx.rSVP.findUnique({
    where: { invitationId },
    select: {
      id: true,
      version: true,
      status: true,
      submittedAt: true,
      dietaryNotes: true,
      submittedByAdminUserId: true,
      adminOverrideReason: true,
      attendees: {
        select: {
          attendeeType: true,
          inviteeId: true,
          quantity: true,
          displayName: true,
          invitee: { select: { fullName: true } },
        },
      },
      eventSelections: {
        select: {
          eventId: true,
          attending: true,
          expectedAttendeeCount: true,
          event: { select: { name: true } },
        },
      },
    },
  });
  if (!row) return null;
  const values: RsvpHistoryValues = {
    status: row.status,
    attendees: row.attendees
      .map((item) => ({
        type: item.attendeeType,
        inviteeId: item.inviteeId,
        quantity: item.quantity,
        name:
          item.invitee?.fullName ??
          item.displayName ??
          (item.attendeeType === "UNNAMED_COMPANION"
            ? "Unnamed companions"
            : item.attendeeType === "PLUS_ONE"
              ? "Plus-one"
              : "Additional children"),
      }))
      .sort((a, b) =>
        `${a.type}/${a.inviteeId ?? ""}`.localeCompare(
          `${b.type}/${b.inviteeId ?? ""}`,
        ),
      ),
    eventSelections: row.eventSelections
      .map((item) => ({
        eventId: item.eventId,
        name: item.event.name,
        attending: item.attending,
        expectedAttendeeCount: item.expectedAttendeeCount,
      }))
      .sort((a, b) => a.eventId.localeCompare(b.eventId)),
    dietaryNotes: row.dietaryNotes,
    submittedByAdminUserId: row.submittedByAdminUserId,
    overrideReason: row.adminOverrideReason,
  };
  return {
    id: row.id,
    version: row.version,
    submittedAt: row.submittedAt,
    values,
  };
}

// Names are audit labels. Identity, quantities and selections determine a no-op.
export function sameRsvpValues(
  before: RsvpHistoryValues,
  after: RsvpHistoryValues,
) {
  const attendees = (values: RsvpHistoryValues) => {
    const quantities = new Map<string, number>();
    for (const item of values.attendees) {
      const key = `${item.type}/${item.inviteeId?.toLowerCase() ?? ""}`;
      quantities.set(key, (quantities.get(key) ?? 0) + item.quantity);
    }
    return [...quantities].sort(([a], [b]) => a.localeCompare(b));
  };
  const comparable = (values: RsvpHistoryValues) => ({
    ...values,
    attendees: attendees(values),
    eventSelections: values.eventSelections
      .filter((selection) => selection.attending)
      .map(({ eventId, attending, expectedAttendeeCount }) => ({
        eventId,
        attending,
        expectedAttendeeCount,
      }))
      .sort((a, b) => a.eventId.localeCompare(b.eventId)),
  });
  return isDeepStrictEqual(comparable(before), comparable(after));
}

export function rsvpHistoryDiff(
  before: RsvpHistoryValues | null,
  after: RsvpHistoryValues,
): RsvpHistoryChange[] {
  const display = (
    values: RsvpHistoryValues | null,
  ): Record<string, string> => ({
    status: values?.status ?? "Not responded",
    attendees:
      values?.attendees
        .map((item) => `${item.name} × ${item.quantity}`)
        .join(", ") || "None",
    expectedAttendance: String(
      values?.attendees.reduce((total, item) => total + item.quantity, 0) ?? 0,
    ),
    events:
      values?.eventSelections
        .filter((item) => item.attending)
        .map(
          (item) =>
            `${item.name} — ${item.attending ? item.expectedAttendeeCount : "Not attending"}`,
        )
        .join(", ") || "None",
    dietaryNotes: values?.dietaryNotes || "None",
    attribution: values?.submittedByAdminUserId
      ? "Authenticated Admin"
      : "Guest-link holder",
    overrideReason: values?.overrideReason || "None",
  });
  const labels: Record<string, string> = {
    status: "Attendance",
    attendees: "Guests",
    expectedAttendance: "Guest count",
    events: "Wedding events and counts",
    dietaryNotes: "Dietary requirements",
    attribution: "Submitted by",
    overrideReason: "Override reason",
  };
  const previous = display(before),
    updated = display(after);
  return Object.keys(labels)
    .filter(
      (field) =>
        previous[field] !== updated[field] ||
        (field === "attendees" &&
          !isDeepStrictEqual(before?.attendees, after.attendees)) ||
        (field === "events" &&
          !isDeepStrictEqual(
            before?.eventSelections.filter((item) => item.attending),
            after.eventSelections.filter((item) => item.attending),
          )) ||
        (field === "attribution" &&
          before?.submittedByAdminUserId !== after.submittedByAdminUserId),
    )
    .map((field) => ({
      field,
      label: labels[field]!,
      before: previous[field]!,
      after: updated[field]!,
    }));
}
