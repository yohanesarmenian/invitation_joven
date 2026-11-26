import type { AdminInvitationListResponse } from "@wedding-invitation/api-client/src/index";

type Item = AdminInvitationListResponse["items"][number];
import { isUuid } from "./contract";

export const sortFields = [
  "createdAt",
  "updatedAt",
  "displayName",
  "status",
  "lastOpenedAt",
] as const;
export type InvitationQuery = {
  page: number;
  pageSize: number;
  sortBy: (typeof sortFields)[number];
  sortOrder: "asc" | "desc";
  status?: Item["status"];
  rsvpStatus?: Item["rsvpStatus"];
  search?: string;
  eligibility?: "includes" | "exact" | "none" | "legacy";
  eventId?: string;
  secondEventId?: string;
  opening?: "opened" | "unopened";
};
export type SearchParams = Record<string, string | string[] | undefined>;
export function parseInvitationQuery(
  params: SearchParams,
): InvitationQuery | null {
  const allowed = [
    "page",
    "pageSize",
    "sortBy",
    "sortOrder",
    "status",
    "rsvpStatus",
    "search",
    "eligibility",
    "eventId",
    "secondEventId",
    "opening",
    "created",
  ];
  if (
    Object.entries(params).some(
      ([key, value]) => !allowed.includes(key) || Array.isArray(value),
    )
  )
    return null;
  const number = (value: string | string[] | undefined, fallback: number) =>
    value === undefined || value === ""
      ? fallback
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  const page = number(params.page, 1),
    pageSize = number(params.pageSize, 25);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  )
    return null;
  const sortBy = params.sortBy ?? "createdAt",
    sortOrder = params.sortOrder ?? "desc";
  if (
    !sortFields.some((field) => field === sortBy) ||
    (sortOrder !== "asc" && sortOrder !== "desc")
  )
    return null;
  const status = params.status || undefined,
    rsvpStatus = params.rsvpStatus || undefined;
  if (status !== undefined && status !== "ACTIVE" && status !== "ARCHIVED")
    return null;
  if (
    rsvpStatus !== undefined &&
    rsvpStatus !== "PENDING" &&
    rsvpStatus !== "ACCEPTED" &&
    rsvpStatus !== "DECLINED"
  )
    return null;
  const search =
    typeof params.search === "string" ? params.search.trim() : undefined;
  if (search && [...search].length > 100) return null;
  if (params.created !== undefined && params.created !== "1") return null;
  const { eligibility, opening, eventId, secondEventId } = params;
  if (
    eligibility !== undefined &&
    eligibility !== "includes" &&
    eligibility !== "exact" &&
    eligibility !== "none" &&
    eligibility !== "legacy"
  )
    return null;
  if (opening !== undefined && opening !== "opened" && opening !== "unopened")
    return null;
  const needsEvent = eligibility === "includes" || eligibility === "exact";
  if (
    (needsEvent && !isUuid(eventId)) ||
    (!needsEvent && (eventId !== undefined || secondEventId !== undefined)) ||
    (secondEventId !== undefined && !isUuid(secondEventId)) ||
    (typeof eventId === "string" &&
      typeof secondEventId === "string" &&
      eventId.toLowerCase() === secondEventId.toLowerCase())
  )
    return null;
  return {
    page,
    pageSize,
    sortBy: sortBy as InvitationQuery["sortBy"],
    sortOrder,
    status,
    rsvpStatus,
    search: search || undefined,
    eligibility,
    eventId: typeof eventId === "string" ? eventId.toLowerCase() : undefined,
    secondEventId:
      typeof secondEventId === "string"
        ? secondEventId.toLowerCase()
        : undefined,
    opening,
  };
}
export function queryString(query: InvitationQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  return params.toString();
}
export function listHref(query: InvitationQuery, page: number): string {
  return `/invitations?${queryString({ ...query, page })}`;
}
