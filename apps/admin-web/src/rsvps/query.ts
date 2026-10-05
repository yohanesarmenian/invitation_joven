import type { AdminEventsResponse } from "@wedding-invitation/api-client/src/index";

export const rsvpSortFields = ["createdAt", "updatedAt", "status"] as const;
export const rsvpStatuses = ["PENDING", "ACCEPTED", "DECLINED"] as const;

export type RsvpQuery = {
  page: number;
  pageSize: number;
  sortBy: (typeof rsvpSortFields)[number];
  sortOrder: "asc" | "desc";
  status?: (typeof rsvpStatuses)[number];
  eventId?: AdminEventsResponse["events"][number]["id"];
  search?: string;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const uuid = (value: string) =>
  /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

export function parseRsvpQuery(params: SearchParams): RsvpQuery | null {
  const allowed = [
    "page",
    "pageSize",
    "sortBy",
    "sortOrder",
    "status",
    "eventId",
    "search",
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
  const page = number(params.page, 1);
  const pageSize = number(params.pageSize, 25);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  )
    return null;

  const sortBy = params.sortBy ?? "updatedAt";
  const sortOrder = params.sortOrder ?? "desc";
  if (
    !rsvpSortFields.some((field) => field === sortBy) ||
    (sortOrder !== "asc" && sortOrder !== "desc")
  )
    return null;

  const status = params.status || undefined;
  if (
    status !== undefined &&
    !rsvpStatuses.some((allowedStatus) => allowedStatus === status)
  )
    return null;

  const eventId =
    typeof params.eventId === "string" && params.eventId
      ? params.eventId
      : undefined;
  if (eventId !== undefined && !uuid(eventId)) return null;

  const search =
    typeof params.search === "string" ? params.search.trim() : undefined;
  if (search && [...search].length > 100) return null;

  return {
    page,
    pageSize,
    sortBy: sortBy as RsvpQuery["sortBy"],
    sortOrder,
    status: status as RsvpQuery["status"],
    eventId,
    search: search || undefined,
  };
}

export function rsvpQueryString(query: RsvpQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) params.set(key, String(value));
  return params.toString();
}

export function rsvpListHref(query: RsvpQuery, page: number): string {
  return `/rsvps?${rsvpQueryString({ ...query, page })}`;
}
