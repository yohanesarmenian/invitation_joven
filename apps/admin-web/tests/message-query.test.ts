import { expect, it } from "vitest";
import {
  messageListHref,
  messageQueryString,
  parseMessageQuery,
} from "../src/messages/query";
import { messageItem } from "./message-fixtures";

it("parses default message list query", () => {
  expect(parseMessageQuery({})).toEqual({
    page: 1,
    pageSize: 25,
    sortBy: "createdAt",
    sortOrder: "desc",
    hidden: "all",
  });
});

it("preserves supported filters and scoped invitation id", () => {
  const query = parseMessageQuery({
    page: "2",
    pageSize: "10",
    sortBy: "createdAt",
    sortOrder: "asc",
    hidden: "hidden",
    invitationId: messageItem.invitation.id,
  });
  expect(query).toMatchObject({
    page: 2,
    pageSize: 10,
    sortBy: "createdAt",
    sortOrder: "asc",
    hidden: "hidden",
    invitationId: messageItem.invitation.id,
  });
  expect(messageQueryString(query!, { scopedPath: true })).not.toContain(
    "invitationId",
  );
  expect(messageListHref(query!, 3)).toContain("page=3");
});

it.each([
  { hidden: "maybe" },
  { invitationId: "not-a-uuid" },
  { sortBy: "message" },
  { pageSize: "101" },
  { page: "0" },
  { search: "guest" },
  { q: "guest" },
  { unknown: "1" },
])("rejects unsupported message query %#", (params) => {
  expect(parseMessageQuery(params)).toBeNull();
});
