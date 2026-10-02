import { expect, it } from "vitest";
import { listHref, parseInvitationQuery } from "../src/invitations/query";
it("defaults to backend pagination and ordering", () => {
  expect(parseInvitationQuery({})).toEqual({
    page: 1,
    pageSize: 25,
    sortBy: "createdAt",
    sortOrder: "desc",
    status: undefined,
    rsvpStatus: undefined,
    search: undefined,
  });
});
it.each([
  { page: "0" },
  { page: "-1" },
  { page: "1.1" },
  { page: "9007199254740992" },
  { page: "9007199254740991", pageSize: "100" },
  { pageSize: "101" },
  { pageSize: "0" },
  { search: ["a", "b"] },
  { status: "active" },
  { rsvpStatus: "OTHER" },
  { sortBy: "notes" },
  { sortOrder: "random" },
  { eventId: "a" },
  { search: "😀".repeat(101) },
  { created: "private" },
])("rejects invalid URL %#", (params) =>
  expect(parseInvitationQuery(params)).toBeNull(),
);
it("trims Unicode search and omits blank; counts code points", () => {
  expect(
    parseInvitationQuery({ search: "  😀".trim() + "😀".repeat(99) })?.search,
  ).toHaveLength(200);
  expect(parseInvitationQuery({ search: "   " })?.search).toBeUndefined();
});
it("preserves all controls while paging, excludes success flag", () => {
  const query = parseInvitationQuery({
    page: "3",
    pageSize: "10",
    search: "  Guest  ",
    status: "ARCHIVED",
    rsvpStatus: "DECLINED",
    sortBy: "displayName",
    sortOrder: "asc",
    created: "1",
  })!;
  const url = new URL(listHref(query, 4), "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    page: "4",
    pageSize: "10",
    search: "Guest",
    status: "ARCHIVED",
    rsvpStatus: "DECLINED",
    sortBy: "displayName",
    sortOrder: "asc",
  });
});
