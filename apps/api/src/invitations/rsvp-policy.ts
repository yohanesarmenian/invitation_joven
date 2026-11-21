import { Prisma } from "../generated/prisma/client.js";

type Deadlines = {
  initialDeadlineAt: Date | null;
  allowLateEdits: boolean;
  finalEditDeadlineAt: Date | null;
};

export type RsvpEditBlockedReason = "DEADLINE_PASSED" | "CHECKED_IN" | null;

export async function readRsvpPolicy(
  tx: Prisma.TransactionClient,
  lock = false,
): Promise<Deadlines> {
  const [policy] = await tx.$queryRaw<Deadlines[]>`
    SELECT initial_deadline_at AS "initialDeadlineAt",
      allow_late_edits AS "allowLateEdits",
      final_edit_deadline_at AS "finalEditDeadlineAt"
    FROM wedding_rsvp_policy WHERE id = 1 ${lock ? Prisma.sql`FOR SHARE` : Prisma.empty}
  `;
  if (!policy) throw new Error("Wedding RSVP policy row is missing.");
  return policy;
}

export function rsvpEditBlockedReason(
  now: Date,
  invitationDeadline: Date | null,
  policy: Deadlines,
  status: string | undefined,
  checkedIn: boolean,
): RsvpEditBlockedReason {
  if (checkedIn) return "CHECKED_IN";
  const initial = invitationDeadline ?? policy.initialDeadlineAt;
  if (initial === null || now <= initial) return null;
  const hasResponse = status === "ACCEPTED" || status === "DECLINED";
  if (!hasResponse || !policy.allowLateEdits) return "DEADLINE_PASSED";
  return policy.finalEditDeadlineAt && now > policy.finalEditDeadlineAt
    ? "DEADLINE_PASSED"
    : null;
}
