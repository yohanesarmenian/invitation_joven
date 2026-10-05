import { expect, it } from "vitest";
import {
  parseRsvpQuery,
  rsvpListHref,
  rsvpQueryString,
} from "../src/rsvps/query";
import { rsvpEvents } from "./rsvp-fixtures";

it("parses default RSVP list query", () => {
  expect(parseRsvpQuery({})).toEqual({
    page: 1,
    pageSize: 25,
    sortBy: "updatedAt",
    sortOrder: "desc",
  });
});

it("trims bounded search and preserves supported filters", () => {
  const query = parseRsvpQuery({
    page: "2",
    pageSize: "10",
    sortBy: "status",
    sortOrder: "asc",
    status: "ACCEPTED",
    eventId: rsvpEvents[0]!.id,
    search: "  smith  ",
  });
  expect(query).toMatchObject({
    page: 2,
    pageSize: 10,
    sortBy: "status",
    sortOrder: "asc",
    status: "ACCEPTED",
    eventId: rsvpEvents[0]!.id,
    search: "smith",
  });
  expect(rsvpQueryString(query!)).toContain("eventId=");
  expect(rsvpListHref(query!, 3)).toContain("page=3");
});

it.each([
  { status: "ACTIVE" },
  { eventId: "not-a-uuid" },
  { sortBy: "displayName" },
  { search: "a".repeat(101) },
  { pageSize: "101" },
  { page: "0" },
  { unknown: "1" },
])("rejects unsupported query %#", (params) => {
  expect(parseRsvpQuery(params)).toBeNull();
});
