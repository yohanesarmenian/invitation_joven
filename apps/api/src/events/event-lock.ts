import { Prisma } from "../generated/prisma/client.js";

// Invitation writers already own the invitation lock. Acquire event locks in
// UUID order, before reading mutable event facts, and retain them until commit.
// Management owns only an event lock and never waits on an invitation lock.
export async function lockEvents(
  tx: Prisma.TransactionClient,
  eventIds: readonly string[],
): Promise<void> {
  if (eventIds.length === 0) return;
  await tx.$queryRaw`
    SELECT id FROM events
    WHERE id IN (${Prisma.join([...new Set(eventIds)].map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id FOR SHARE
  `;
}
