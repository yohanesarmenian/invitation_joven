export const messageHiddenFilters = ["all", "visible", "hidden"] as const;
export const messageSortFields = ["createdAt"] as const;

export type MessageQuery = {
  page: number;
  pageSize: number;
  sortBy: (typeof messageSortFields)[number];
  sortOrder: "asc" | "desc";
  hidden: (typeof messageHiddenFilters)[number];
  invitationId?: string;
};

export type SearchParams = Record<string, string | string[] | undefined>;

export const isUuid = (value: unknown) =>
  typeof value === "string" &&
  /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);

export function parseMessageQuery(params: SearchParams): MessageQuery | null {
  const allowed = [
    "page",
    "pageSize",
    "sortBy",
    "sortOrder",
    "hidden",
    "invitationId",
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

  const hidden = params.hidden ?? "all";
  if (!messageHiddenFilters.some((filter) => filter === hidden)) return null;

  const sortBy = params.sortBy ?? "createdAt";
  const sortOrder = params.sortOrder ?? "desc";
  if (
    !messageSortFields.some((field) => field === sortBy) ||
    (sortOrder !== "asc" && sortOrder !== "desc")
  )
    return null;

  const invitationId =
    typeof params.invitationId === "string" && params.invitationId
      ? params.invitationId
      : undefined;
  if (invitationId !== undefined && !isUuid(invitationId)) return null;

  return {
    page,
    pageSize,
    sortBy: sortBy as MessageQuery["sortBy"],
    sortOrder,
    hidden: hidden as MessageQuery["hidden"],
    invitationId,
  };
}

export function messageQueryString(
  query: MessageQuery,
  options?: { scopedPath?: boolean },
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (
      value !== undefined &&
      !(options?.scopedPath && key === "invitationId")
    )
      params.set(key, String(value));
  return params.toString();
}

export function messageListHref(query: MessageQuery, page: number): string {
  return `/messages?${messageQueryString({ ...query, page })}`;
}
