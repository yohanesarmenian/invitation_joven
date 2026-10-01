import { validationError } from "../auth/auth-errors.js";

export type AdminPageRequest = {
  number: number;
  pageSize: number;
  skip: number;
};

export type AdminPageMetadata = {
  number: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type AdminSortOrder = "asc" | "desc";

export type AdminSortRequest<TSortBy extends string> = {
  sortBy: TSortBy;
  sortOrder: AdminSortOrder;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_CODE_POINTS = 100;

function parseOptionalInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (Array.isArray(value)) {
    validationError();
  }

  const text = String(value);

  if (!/^\d+$/.test(text)) {
    validationError();
  }

  const parsed = Number(text);

  if (!Number.isSafeInteger(parsed)) {
    validationError();
  }

  return parsed;
}

export function parseAdminPagination(query: Record<string, unknown>): AdminPageRequest {
  const number = parseOptionalInteger(query.page) ?? DEFAULT_PAGE;
  const pageSize = parseOptionalInteger(query.pageSize) ?? DEFAULT_PAGE_SIZE;

  if (number < 1 || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    validationError();
  }

  const skip = (number - 1) * pageSize;

  if (!Number.isSafeInteger(skip)) {
    validationError();
  }

  return { number, pageSize, skip };
}

export function buildAdminPageMetadata(
  request: AdminPageRequest,
  totalItems: number,
): AdminPageMetadata {
  return {
    number: request.number,
    pageSize: request.pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / request.pageSize),
  };
}

export function parseAdminSort<TSortBy extends string>(
  query: Record<string, unknown>,
  allowedSortBy: readonly TSortBy[],
  defaults: AdminSortRequest<TSortBy>,
): AdminSortRequest<TSortBy> {
  const sortBy = query.sortBy ?? defaults.sortBy;
  const sortOrder = query.sortOrder ?? defaults.sortOrder;

  if (
    Array.isArray(sortBy) ||
    Array.isArray(sortOrder) ||
    !allowedSortBy.includes(sortBy as TSortBy) ||
    (sortOrder !== "asc" && sortOrder !== "desc")
  ) {
    validationError();
  }

  return {
    sortBy: sortBy as TSortBy,
    sortOrder,
  };
}

export function parseAdminSearch(query: Record<string, unknown>): string | null {
  const value = query.search;

  if (value === undefined || value === null) {
    return null;
  }

  if (Array.isArray(value) || typeof value !== "string") {
    validationError();
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  if ([...normalized].length > MAX_SEARCH_CODE_POINTS) {
    validationError();
  }

  return normalized;
}
