import type { AdminInvitationListResponse } from "@wedding-invitation/api-client/src/index";

type Item = AdminInvitationListResponse["items"][number];
// OpenAPI currently omits GET query metadata. These bounded controls follow
// API-CONTRACT.md and admin-read.service.ts / common/admin-query.ts.
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
  return {
    page,
    pageSize,
    sortBy: sortBy as InvitationQuery["sortBy"],
    sortOrder,
    status,
    rsvpStatus,
    search: search || undefined,
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
