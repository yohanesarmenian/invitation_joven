import type { Prisma } from "../generated/prisma/client.js";

export async function extraCapacity(
  tx: Prisma.TransactionClient,
  invitationId: string,
  eventId: string,
) {
  const [row] = await tx.$queryRaw<
    { count: number }[]
  >`SELECT coalesce(sum(capacity_delta),0)::int AS count FROM reception_actions WHERE invitation_id=${invitationId}::uuid AND event_id=${eventId}::uuid`;
  return row?.count ?? 0;
}
export async function attendanceRevision(
  tx: Prisma.TransactionClient,
  invitationId: string,
  eventId: string,
) {
  const [row] = await tx.$queryRaw<
    { count: number }[]
  >`SELECT ((SELECT count(*) FROM checkin_arrivals WHERE invitation_id=${invitationId}::uuid AND event_id=${eventId}::uuid)+(SELECT count(*) FROM reception_actions WHERE invitation_id=${invitationId}::uuid AND event_id=${eventId}::uuid AND kind<>'WALKIN'))::int AS count`;
  return row?.count ?? 0;
}
export async function receptionCandidates(
  tx: Prisma.TransactionClient,
  query: string,
  offset = 0,
) {
  const words = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return [];
  const terms = words.map((word) => `${word}:*`).join(" & ");
  return tx.$queryRaw<{ id: string }[]>`WITH candidates AS (
 SELECT id FROM invitations WHERE reference_code=${query.toUpperCase()}
 UNION SELECT id FROM invitations WHERE public.reception_name_key(display_name)=public.reception_name_key(${query}) OR public.reception_name_key(coalesce(greeting_name,''))=public.reception_name_key(${query})
 UNION SELECT invitation_id FROM invitees WHERE public.reception_name_key(full_name)=public.reception_name_key(${query})
 UNION SELECT id FROM invitations WHERE to_tsvector('simple',coalesce(display_name,'') || ' ' || coalesce(greeting_name,'')) @@ to_tsquery('simple',${terms})
 UNION SELECT invitation_id FROM invitees WHERE to_tsvector('simple',full_name) @@ to_tsquery('simple',${terms})
 ) SELECT i.id FROM invitations i JOIN candidates ON candidates.id=i.id ORDER BY i.display_name,i.id LIMIT 26 OFFSET ${offset}`;
}
