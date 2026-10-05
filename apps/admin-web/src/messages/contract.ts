import type {
  AdminGuestMessageListResponse,
  UpdateAdminGuestMessageResponse,
} from "@wedding-invitation/api-client/src/index";
import { isUuid } from "./query";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const positiveCount = (value: unknown): value is number =>
  count(value) && value >= 1;
const date = (value: unknown) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const forbiddenKeys = new Set([
  "publicTokenHash",
  "publicUrl",
  "qrPayload",
  "sessionToken",
  "sessionTokenHash",
  "tokenHash",
  "csrfTokenHash",
  "passwordHash",
  "dietaryNotes",
  "guestNote",
  "hiddenAt",
  "hiddenByAdminUserId",
  "moderatedAt",
  "moderationReason",
]);

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!object(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => forbiddenKeys.has(key) || hasForbiddenKey(nested),
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isPage(value: unknown) {
  if (!object(value)) return false;
  const pageSize = value.pageSize;
  const totalItems = value.totalItems;
  return (
    positiveCount(value.number) &&
    positiveCount(pageSize) &&
    pageSize <= 100 &&
    count(totalItems) &&
    count(value.totalPages) &&
    value.totalPages === Math.ceil(totalItems / pageSize)
  );
}

function isInvitationSummary(value: unknown) {
  return (
    object(value) &&
    hasOnlyKeys(value, ["id", "displayName"]) &&
    isUuid(value.id) &&
    typeof value.displayName === "string"
  );
}

export function isGuestMessageItem(
  value: unknown,
): value is UpdateAdminGuestMessageResponse {
  return (
    object(value) &&
    !hasForbiddenKey(value) &&
    hasOnlyKeys(value, [
      "id",
      "invitation",
      "authorName",
      "message",
      "createdAt",
      "isHidden",
    ]) &&
    isUuid(value.id) &&
    isInvitationSummary(value.invitation) &&
    (value.authorName === null || typeof value.authorName === "string") &&
    typeof value.message === "string" &&
    date(value.createdAt) &&
    typeof value.isHidden === "boolean"
  );
}

export function isGuestMessageList(
  value: unknown,
): value is AdminGuestMessageListResponse {
  if (!object(value) || !object(value.page) || hasForbiddenKey(value))
    return false;
  const page = value.page;
  return (
    Array.isArray(value.items) &&
    isPage(page) &&
    value.items.length <= (page as { pageSize: number }).pageSize &&
    value.items.every(isGuestMessageItem)
  );
}
